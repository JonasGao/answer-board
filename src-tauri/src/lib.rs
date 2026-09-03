use axum::{
    body::Bytes,
    extract::State,
    http::{header::CONTENT_TYPE, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Router,
};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, env, net::SocketAddr, sync::Arc};
use tauri::{AppHandle, Emitter};
use tokio::{net::TcpListener, sync::Mutex};

const LOCAL_ID: &str = "local";
const DEFAULT_BIND: &str = "0.0.0.0:8787";
const CHANGE_EVENT: &str = "board-changed";
const DEFAULT_ANSWER: &str = "As suggested";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Entry {
    pub id: u64,
    pub number: u32,
    pub question: String,
    pub recommendation: String,
    pub text: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Round {
    pub revision: u64,
    pub entries: Vec<Entry>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Session {
    pub id: String,
    pub name: String,
    pub local: bool,
    pub current: Option<Round>,
    pub pending: Option<Round>,
}
#[derive(Debug)]
pub struct BoardState {
    sessions: Vec<Session>,
    next_entry_id: u64,
    next_round_revision: u64,
}

impl Default for BoardState {
    fn default() -> Self {
        Self {
            sessions: vec![Session {
                id: LOCAL_ID.into(),
                name: "Local".into(),
                local: true,
                current: Some(Round {
                    revision: 1,
                    entries: vec![],
                }),
                pending: None,
            }],
            next_entry_id: 1,
            next_round_revision: 2,
        }
    }
}

type SharedState = Arc<Mutex<BoardState>>;

#[derive(Debug, Deserialize)]
struct IncomingQuestion {
    number: u32,
    body: String,
    recommendation: String,
}
#[derive(Debug, Deserialize)]
struct RoundRequest {
    session_id: String,
    session_name: Option<String>,
    questions: Option<Vec<IncomingQuestion>>,
    markdown: Option<String>,
}
#[derive(Serialize)]
struct DeliveryResponse {
    status: &'static str,
}
#[derive(Clone, Serialize)]
struct BoardChange {
    session_id: String,
    status: &'static str,
}
#[derive(Debug, Deserialize)]
struct ReplaceEntries {
    session_id: String,
    revision: u64,
    entries: Vec<Entry>,
}

fn validate_questions(questions: Vec<IncomingQuestion>) -> Result<Vec<IncomingQuestion>, String> {
    if questions.is_empty() {
        return Err("questions must not be empty".into());
    }
    let mut numbers = HashSet::new();
    for question in &questions {
        if question.number == 0 {
            return Err("question number must be a positive integer".into());
        }
        if !numbers.insert(question.number) {
            return Err(format!("duplicate question number: {}", question.number));
        }
        if question.body.trim().is_empty() {
            return Err(format!("Q{} body must not be empty", question.number));
        }
        if question.recommendation.trim().is_empty() {
            return Err(format!(
                "Q{} recommendation must not be empty",
                question.number
            ));
        }
    }
    Ok(questions)
}

fn parse_markdown(markdown: &str) -> Result<Vec<IncomingQuestion>, String> {
    let question_re =
        Regex::new(r"^\s*❓\s*\*\*Q([1-9][0-9]*)\*\*\s*(?:-|–|—|:)\s*(.*)\s*$").unwrap();
    let recommendation_re = Regex::new(r"^\s*➡️\s*(.*)\s*$").unwrap();
    let lines: Vec<&str> = markdown.lines().collect();
    let mut questions = Vec::new();
    let mut index = 0;
    while index < lines.len() {
        let Some(captures) = question_re.captures(lines[index]) else {
            if lines[index].trim().is_empty() {
                index += 1;
                continue;
            }
            return Err(format!("expected a question header at line {}", index + 1));
        };
        let number = captures[1]
            .parse::<u32>()
            .map_err(|_| "invalid question number")?;
        let mut body_lines = vec![captures.get(2).map_or("", |m| m.as_str()).trim_end()];
        index += 1;
        let mut recommendation_first = None;
        while index < lines.len() {
            if let Some(rec) = recommendation_re.captures(lines[index]) {
                recommendation_first = Some(rec.get(1).map_or("", |m| m.as_str()).trim_end());
                index += 1;
                break;
            }
            if question_re.is_match(lines[index]) {
                return Err(format!("Q{number} is missing a recommendation"));
            }
            body_lines.push(lines[index]);
            index += 1;
        }
        let Some(first) = recommendation_first else {
            return Err(format!("Q{number} is missing a recommendation"));
        };
        let mut recommendation_lines = vec![first];
        while index < lines.len() && !question_re.is_match(lines[index]) {
            recommendation_lines.push(lines[index]);
            index += 1;
        }
        questions.push(IncomingQuestion {
            number,
            body: body_lines.join("\n").trim().into(),
            recommendation: recommendation_lines.join("\n").trim().into(),
        });
    }
    validate_questions(questions)
}

fn request_questions(
    request: RoundRequest,
) -> Result<(String, Option<String>, Vec<IncomingQuestion>), String> {
    let session_id = request.session_id.trim().to_string();
    if session_id.is_empty() || session_id == LOCAL_ID {
        return Err("session_id must be non-empty and must not be 'local'".into());
    }
    let questions = match (request.questions, request.markdown) {
        (Some(questions), None) => validate_questions(questions)?,
        (None, Some(markdown)) if !markdown.trim().is_empty() => parse_markdown(&markdown)?,
        _ => return Err("provide exactly one of questions or markdown".into()),
    };
    let name = request
        .session_name
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty());
    Ok((session_id, name, questions))
}

fn make_round(state: &mut BoardState, questions: Vec<IncomingQuestion>) -> Round {
    let revision = state.next_round_revision;
    state.next_round_revision += 1;
    let mut entries = questions
        .into_iter()
        .map(|question| {
            let entry = Entry {
                id: state.next_entry_id,
                number: question.number,
                question: question.body,
                recommendation: question.recommendation,
                text: DEFAULT_ANSWER.into(),
            };
            state.next_entry_id += 1;
            entry
        })
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.number);
    Round { revision, entries }
}

fn apply_round(
    state: &mut BoardState,
    session_id: String,
    session_name: Option<String>,
    questions: Vec<IncomingQuestion>,
) -> Result<&'static str, String> {
    let existing = state
        .sessions
        .iter()
        .position(|session| session.id == session_id);
    if existing.is_some_and(|index| state.sessions[index].pending.is_some()) {
        return Err("this session already has a pending round".into());
    }

    let round = make_round(state, questions);
    let Some(index) = existing else {
        state.sessions.push(Session {
            id: session_id.clone(),
            name: session_name.unwrap_or(session_id),
            local: false,
            current: Some(round),
            pending: None,
        });
        return Ok("applied");
    };

    let session = &mut state.sessions[index];
    if let Some(name) = session_name {
        session.name = name;
    }
    if session.current.is_none() {
        session.current = Some(round);
        Ok("applied")
    } else {
        session.pending = Some(round);
        Ok("queued")
    }
}

fn advance_session(state: &mut BoardState, session_id: &str) -> Result<(), String> {
    let session = state
        .sessions
        .iter_mut()
        .find(|session| session.id == session_id)
        .ok_or("session not found")?;
    session.current = Some(session.pending.take().ok_or("no pending round")?);
    Ok(())
}

async fn deliver_round(
    State((state, app)): State<(SharedState, AppHandle)>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| {
            value
                .split(';')
                .next()
                .is_some_and(|kind| kind.trim().eq_ignore_ascii_case("application/json"))
        })
    {
        return error_response(
            StatusCode::BAD_REQUEST,
            "Content-Type must be application/json",
        );
    }
    let request: RoundRequest = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(error) => {
            return error_response(StatusCode::BAD_REQUEST, &format!("invalid JSON: {error}"))
        }
    };
    let (session_id, session_name, questions) = match request_questions(request) {
        Ok(parsed) => parsed,
        Err(error) => return error_response(StatusCode::BAD_REQUEST, &error),
    };
    let delivery_status = match {
        let mut board = state.lock().await;
        apply_round(&mut board, session_id.clone(), session_name, questions)
    } {
        Ok(status) => status,
        Err(error) => return error_response(StatusCode::CONFLICT, &error),
    };
    let _ = app.emit(
        CHANGE_EVENT,
        BoardChange {
            session_id,
            status: delivery_status,
        },
    );
    (
        StatusCode::OK,
        axum::Json(DeliveryResponse {
            status: delivery_status,
        }),
    )
        .into_response()
}

fn error_response(status: StatusCode, message: &str) -> Response {
    (status, axum::Json(serde_json::json!({ "error": message }))).into_response()
}

#[tauri::command]
async fn get_sessions(state: tauri::State<'_, SharedState>) -> Result<Vec<Session>, String> {
    Ok(state.lock().await.sessions.clone())
}

#[tauri::command]
async fn replace_entries(
    payload: ReplaceEntries,
    state: tauri::State<'_, SharedState>,
) -> Result<(), String> {
    let mut board = state.lock().await;
    let max_id = payload.entries.iter().map(|entry| entry.id).max();
    let mut numbers = HashSet::new();
    if payload
        .entries
        .iter()
        .any(|entry| entry.number == 0 || !numbers.insert(entry.number))
    {
        return Err("entry numbers must be positive and unique".into());
    }
    let session_index = board
        .sessions
        .iter()
        .position(|session| session.id == payload.session_id)
        .ok_or("session not found")?;
    let current_revision = board.sessions[session_index]
        .current
        .as_ref()
        .ok_or("session has no current round")?
        .revision;
    if current_revision != payload.revision {
        return Err("current round changed before the entries were saved".into());
    }
    if let Some(max_id) = max_id {
        board.next_entry_id = board.next_entry_id.max(max_id.saturating_add(1));
    }
    let current = board.sessions[session_index]
        .current
        .as_mut()
        .expect("current round checked above");
    current.entries = payload.entries;
    Ok(())
}

#[tauri::command]
async fn advance_round(
    session_id: String,
    state: tauri::State<'_, SharedState>,
) -> Result<(), String> {
    let mut board = state.lock().await;
    advance_session(&mut board, &session_id)
}

#[tauri::command]
async fn close_session(
    session_id: String,
    state: tauri::State<'_, SharedState>,
) -> Result<(), String> {
    if session_id == LOCAL_ID {
        return Err("the Local session cannot be closed".into());
    }
    let mut board = state.lock().await;
    let before = board.sessions.len();
    board.sessions.retain(|session| session.id != session_id);
    if before == board.sessions.len() {
        return Err("session not found".into());
    }
    Ok(())
}

async fn serve_http(state: SharedState, app: AppHandle) {
    let bind = env::var("ANSWER_BOARD_HTTP_BIND").unwrap_or_else(|_| DEFAULT_BIND.into());
    let address: SocketAddr = match bind.parse() {
        Ok(address) => address,
        Err(error) => {
            eprintln!("invalid ANSWER_BOARD_HTTP_BIND {bind:?}: {error}");
            return;
        }
    };
    let listener = match TcpListener::bind(address).await {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("failed to bind Answer Board HTTP server to {address}: {error}");
            return;
        }
    };
    println!("Answer Board HTTP endpoint listening on http://{address}/api/rounds");
    let router = Router::new()
        .route("/api/rounds", post(deliver_round))
        .with_state((state, app));
    if let Err(error) = axum::serve(listener, router).await {
        eprintln!("Answer Board HTTP server stopped: {error}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = Arc::new(Mutex::new(BoardState::default()));
    tauri::Builder::default()
        .manage(state.clone())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            get_sessions,
            replace_entries,
            advance_round,
            close_session
        ])
        .setup(move |app| {
            tauri::async_runtime::spawn(serve_http(state.clone(), app.handle().clone()));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_multiple_grilling_questions_with_multiline_content() {
        let parsed = parse_markdown("❓ **Q2** - **Choice**: Pick one\n\n- A\n- B\n\n➡️ Recommended B\nwith a reason\n\n❓ **Q4** — **Risk**: What fails?\n\n➡️ **Accept** the risk").unwrap();
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].number, 2);
        assert!(parsed[0].body.contains("**Choice**: Pick one"));
        assert!(parsed[0].body.contains("- A"));
        assert_eq!(parsed[0].recommendation, "Recommended B\nwith a reason");
        assert_eq!(parsed[1].number, 4);
    }
    #[test]
    fn rejects_duplicates_and_missing_recommendation() {
        assert!(parse_markdown("❓ **Q1** - One\n➡️ Yes\n❓ **Q1** - Again\n➡️ No").is_err());
        assert!(parse_markdown("❓ **Q1** - One").is_err());
    }
    #[test]
    fn initial_state_has_only_empty_local_session() {
        let state = BoardState::default();
        assert_eq!(state.sessions.len(), 1);
        assert!(state.sessions[0].local);
        assert!(state.sessions[0]
            .current
            .as_ref()
            .unwrap()
            .entries
            .is_empty());
    }

    fn question(number: u32) -> IncomingQuestion {
        IncomingQuestion {
            number,
            body: format!("Question {number}"),
            recommendation: format!("Recommendation {number}"),
        }
    }

    #[test]
    fn second_round_is_queued_until_the_first_is_advanced() {
        let mut state = BoardState::default();
        assert_eq!(
            apply_round(&mut state, "agent".into(), None, vec![question(1)]).unwrap(),
            "applied"
        );
        assert_eq!(
            apply_round(&mut state, "agent".into(), None, vec![question(2)]).unwrap(),
            "queued"
        );
        assert!(apply_round(&mut state, "agent".into(), None, vec![question(3)]).is_err());
        advance_session(&mut state, "agent").unwrap();
        assert!(state.sessions[1].pending.is_none());
        assert_eq!(
            state.sessions[1].current.as_ref().unwrap().entries[0].number,
            2
        );
        assert_eq!(
            apply_round(&mut state, "agent".into(), None, vec![question(3)]).unwrap(),
            "queued"
        );
    }
}
