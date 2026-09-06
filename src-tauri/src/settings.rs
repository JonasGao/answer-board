use serde::{Deserialize, Serialize};
use std::{
    fs, io,
    path::{Path, PathBuf},
};

pub const DEFAULT_BIND_ADDRESS: &str = "127.0.0.1";
pub const DEFAULT_BIND_PORT: u16 = 8787;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct FontSettings {
    #[serde(rename = "ui", alias = "uiFont")]
    pub ui_font: String,
    #[serde(rename = "uiSize", alias = "uiFontSize")]
    pub ui_font_size: Option<u16>,
    #[serde(rename = "input", alias = "inputFont")]
    pub input_font: String,
    #[serde(rename = "inputSize", alias = "inputFontSize")]
    pub input_font_size: Option<u16>,
    #[serde(rename = "number", alias = "numberFont")]
    pub number_font: String,
    #[serde(rename = "numberSize", alias = "numberFontSize")]
    pub number_font_size: Option<u16>,
    #[serde(rename = "question", alias = "questionFont")]
    pub question_font: String,
    #[serde(rename = "questionSize", alias = "questionFontSize")]
    pub question_font_size: Option<u16>,
    #[serde(rename = "code", alias = "codeFont")]
    pub code_font: String,
}

impl Default for FontSettings {
    fn default() -> Self {
        Self {
            ui_font: String::new(),
            ui_font_size: None,
            input_font: String::new(),
            input_font_size: None,
            number_font: String::new(),
            number_font_size: None,
            question_font: String::new(),
            question_font_size: None,
            code_font: String::new(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct ServiceSettings {
    pub bind_address: String,
    pub bind_port: u16,
}

impl Default for ServiceSettings {
    fn default() -> Self {
        Self {
            bind_address: DEFAULT_BIND_ADDRESS.into(),
            bind_port: DEFAULT_BIND_PORT,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub theme: String,
    pub fonts: FontSettings,
    pub service: ServiceSettings,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            fonts: FontSettings::default(),
            service: ServiceSettings::default(),
        }
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ServiceSource {
    Environment,
    Saved,
    Default,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ServiceStatus {
    Running,
    Stopped,
    Error,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub theme: String,
    pub fonts: FontSettings,
    pub service: ServiceSettings,
    pub service_source: ServiceSource,
    pub service_status: ServiceStatus,
    pub service_error: Option<String>,
}

#[derive(Debug)]
pub struct SettingsStore {
    path: PathBuf,
    pub saved: AppSettings,
}

impl SettingsStore {
    pub fn new(path: PathBuf, saved: AppSettings) -> Self {
        Self { path, saved }
    }

    pub fn load(path: PathBuf) -> Result<(Self, bool), String> {
        if !path.exists() {
            return Ok((Self::new(path, AppSettings::default()), false));
        }
        let raw =
            fs::read_to_string(&path).map_err(|error| format_config_error("read", &path, error))?;
        let settings = serde_json::from_str::<AppSettings>(&raw).map_err(|error| {
            format!("could not parse settings file {}: {error}", path.display())
        })?;
        Ok((Self::new(path, settings), true))
    }

    pub fn save(&self) -> Result<(), String> {
        let parent = self
            .path
            .parent()
            .ok_or_else(|| "settings path has no parent directory".to_string())?;
        fs::create_dir_all(parent).map_err(|error| format_config_error("create", parent, error))?;
        let temp = self.path.with_extension("json.tmp");
        let encoded = serde_json::to_vec_pretty(&self.saved)
            .map_err(|error| format!("could not encode settings: {error}"))?;
        fs::write(&temp, encoded).map_err(|error| format_config_error("write", &temp, error))?;
        replace_file(&temp, &self.path)
            .map_err(|error| format_config_error("replace", &self.path, error))
    }
}

fn replace_file(temp: &Path, target: &Path) -> io::Result<()> {
    #[cfg(windows)]
    {
        if target.exists() {
            fs::remove_file(target)?;
        }
    }
    fs::rename(temp, target)
}

fn format_config_error(action: &str, path: &Path, error: io::Error) -> String {
    format!(
        "could not {action} settings file {}: {error}",
        path.display()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_socket_contract() {
        let settings = AppSettings::default();
        assert_eq!(settings.service.bind_address, DEFAULT_BIND_ADDRESS);
        assert_eq!(settings.service.bind_port, DEFAULT_BIND_PORT);
        assert_eq!(settings.theme, "system");
    }

    #[test]
    fn settings_round_trip_uses_camel_case() {
        let value = serde_json::to_value(AppSettings::default()).unwrap();
        assert_eq!(value["service"]["bindAddress"], DEFAULT_BIND_ADDRESS);
        assert_eq!(value["service"]["bindPort"], DEFAULT_BIND_PORT);
        assert!(value["fonts"]["uiSize"].is_null());
    }
}
