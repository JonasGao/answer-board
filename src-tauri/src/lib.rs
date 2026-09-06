use regex::Regex;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    env,
    net::SocketAddr,
    sync::Arc,
    time::Duration,
};
use tauri::{AppHandle, Emitter};
use tokio::{
    io::{AsyncBufReadExt, AsyncWrite, AsyncWriteExt, BufReader},
    net::{TcpListener, TcpStream},
    sync::{oneshot, Mutex},
    time::{interval, MissedTickBehavior},
};

const LOCAL_ID: &str = "local";
const LOCAL_ROUND_ID: &str = "local-round";
const DEFAULT_BIND: &str = "127.0.0.1:8787";
const CHANGE_EVENT: &str = "board-changed";
const DEFAULT_ANSWER: &str = "As suggested";
const PROTOCOL_VERSION: u8 = 1;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Entry {
    pub id: u64,
    pub number: u32,
    pub question: String,
    pub recommendation: String,
    pub text: String,
    pub answered: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RoundStatus {
    Draft,
    Answering,
    Completed,
    Stopped,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Round {
    pub round_id: String,
    pub sequence: u64,
    pub revision: u64,
    pub entries: Vec<Entry>,
    pub status: RoundStatus,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Session {
    pub id: String,
    pub name: String,
    pub local: bool,
    pub rounds: Vec<Round>,
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
                rounds: vec![Round {
                    round_id: LOCAL_ROUND_ID.into(),
                    sequence: 1,
                    revision: 1,
                    entries: vec![],
                    status: RoundStatus::Draft,
                }],
            }],
            next_entry_id: 1,
            next_round_revision: 2,
        }
    }
}

type SharedState = Arc<Mutex<BoardState>>;
type RoundKey = (String, String);

#[derive(Debug, Deserialize)]
struct IncomingQuestion {
    number: u32,
    body: String,
    recommendation: String,
}

#[derive(Debug, Deserialize)]
struct DeliverRequest {
    protocol: Option<u8>,
    session_id: String,
    round_id: String,
    session_name: Option<String>,
    questions: Option<Vec<IncomingQuestion>>,
    markdown: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum ClientMessage {
    #[serde(rename = "deliver")]
    Deliver(DeliverRequest),
    #[serde(rename = "result_ack")]
    ResultAck { round_id: String },
    #[serde(rename = "cancel")]
    Cancel {
        session_id: String,
        round_id: String,
        revision: Option<u64>,
    },
    #[serde(rename = "pong")]
    Pong,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct AnswerResult {
    pub number: u32,
    pub text: String,
    pub answered: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct RoundResult {
    #[serde(rename = "type")]
    pub message_type: &'static str,
    pub protocol: u8,
    pub session_id: String,
    pub round_id: String,
    pub revision: u64,
    pub status: &'static str,
    pub answers: Vec<AnswerResult>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type")]
enum ServerMessage {
    #[serde(rename = "delivery_ack")]
    DeliveryAck {
        protocol: u8,
        session_id: String,
        round_id: String,
        revision: u64,
        status: &'static str,
    },
    #[serde(rename = "round_result")]
    RoundResult {
        protocol: u8,
        session_id: String,
        round_id: String,
        revision: u64,
        status: &'static str,
        answers: Vec<AnswerResult>,
    },
    #[serde(rename = "ping")]
    Ping { protocol: u8 },
    #[serde(rename = "error")]
    Error {
        protocol: u8,
        code: &'static str,
        message: String,
    },
}

#[derive(Clone, Serialize)]
struct BoardChange {
    session_id: String,
    round_id: String,
    status: &'static str,
}

#[derive(Debug, Deserialize)]
struct ReplaceEntries {
    session_id: String,
    round_id: String,
    revision: u64,
    entries: Vec<Entry>,
}

#[derive(Debug, Deserialize)]
struct RoundControl {
    session_id: String,
    round_id: String,
    revision: u64,
}

#[derive(Default)]
struct HubState {
    waiters: HashMap<RoundKey, Vec<oneshot::Sender<RoundResult>>>,
    results: HashMap<RoundKey, RoundResult>,
}

#[derive(Default, Clone)]
struct DeliveryHub {
    state: Arc<Mutex<HubState>>,
}

impl DeliveryHub {
    async fn subscribe(&self, key: RoundKey) -> oneshot::Receiver<RoundResult> {
        let (sender, receiver) = oneshot::channel();
        let mut hub = self.state.lock().await;
        if let Some(result) = hub.results.get(&key).cloned() {
            let _ = sender.send(result);
        } else {
            hub.waiters.entry(key).or_default().push(sender);
        }
        receiver
    }

    async fn publish(&self, result: RoundResult) {
        let key = (result.session_id.clone(), result.round_id.clone());
        let mut hub = self.state.lock().await;
        hub.results.insert(key.clone(), result.clone());
        let waiters = hub.waiters.remove(&key).unwrap_or_default();
        for waiter in waiters {
            let _ = waiter.send(result.clone());
        }
    }
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
    request: DeliverRequest,
) -> Result<(String, String, Option<String>, Vec<IncomingQuestion>), String> {
    if request.protocol.unwrap_or(PROTOCOL_VERSION) != PROTOCOL_VERSION {
        return Err("unsupported protocol version".into());
    }
    let session_id = request.session_id.trim().to_string();
    if session_id.is_empty() || session_id == LOCAL_ID {
        return Err("session_id must be non-empty and must not be 'local'".into());
    }
    let round_id = request.round_id.trim().to_string();
    if round_id.is_empty() {
        return Err("round_id must not be empty".into());
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
    Ok((session_id, round_id, name, questions))
}

fn make_round(
    state: &mut BoardState,
    round_id: String,
    sequence: u64,
    status: RoundStatus,
    questions: Vec<IncomingQuestion>,
) -> Round {
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
                answered: false,
            };
            state.next_entry_id += 1;
            entry
        })
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.number);
    Round {
        round_id,
        sequence,
        revision,
        entries,
        status,
    }
}

fn result_for(session_id: &str, round: &Round) -> RoundResult {
    let status = match round.status {
        RoundStatus::Completed => "completed",
        RoundStatus::Stopped => "stopped",
        _ => "answering",
    };
    RoundResult {
        message_type: "round_result",
        protocol: PROTOCOL_VERSION,
        session_id: session_id.into(),
        round_id: round.round_id.clone(),
        revision: round.revision,
        status,
        answers: round
            .entries
            .iter()
            .map(|entry| AnswerResult {
                number: entry.number,
                text: entry.text.clone(),
                answered: entry.answered,
            })
            .collect(),
    }
}

enum DeliveryRegistration {
    Waiting {
        key: RoundKey,
        revision: u64,
        status: &'static str,
    },
    Finished(RoundResult),
}

fn register_delivery(
    state: &mut BoardState,
    session_id: String,
    round_id: String,
    session_name: Option<String>,
    questions: Vec<IncomingQuestion>,
) -> Result<DeliveryRegistration, String> {
    let existing = state
        .sessions
        .iter()
        .position(|session| session.id == session_id);
    let Some(index) = existing else {
        let round = make_round(
            state,
            round_id.clone(),
            1,
            RoundStatus::Answering,
            questions,
        );
        let revision = round.revision;
        state.sessions.push(Session {
            id: session_id.clone(),
            name: session_name.unwrap_or_else(|| session_id.clone()),
            local: false,
            rounds: vec![round],
        });
        return Ok(DeliveryRegistration::Waiting {
            key: (session_id, round_id),
            revision,
            status: "accepted",
        });
    };

    if let Some(name) = session_name {
        state.sessions[index].name = name;
    }
    if let Some(existing_round) = state.sessions[index]
        .rounds
        .iter()
        .find(|round| round.round_id == round_id)
    {
        return match existing_round.status {
            RoundStatus::Completed | RoundStatus::Stopped => Ok(DeliveryRegistration::Finished(
                result_for(&session_id, existing_round),
            )),
            RoundStatus::Answering => Ok(DeliveryRegistration::Waiting {
                key: (session_id, round_id),
                revision: existing_round.revision,
                status: "resumed",
            }),
            RoundStatus::Draft => Err("draft rounds cannot receive delivery".into()),
        };
    }
    if state.sessions[index]
        .rounds
        .last()
        .is_some_and(|round| matches!(round.status, RoundStatus::Answering))
    {
        return Err("this session already has an answering round".into());
    }
    let sequence = state.sessions[index].rounds.len() as u64 + 1;
    let round = make_round(
        state,
        round_id.clone(),
        sequence,
        RoundStatus::Answering,
        questions,
    );
    let revision = round.revision;
    state.sessions[index].rounds.push(round);
    Ok(DeliveryRegistration::Waiting {
        key: (session_id, round_id),
        revision,
        status: "accepted",
    })
}

fn finish_round(
    state: &mut BoardState,
    control: &RoundControl,
    status: RoundStatus,
) -> Result<RoundResult, String> {
    let session = state
        .sessions
        .iter_mut()
        .find(|session| session.id == control.session_id)
        .ok_or("session not found")?;
    let round = session
        .rounds
        .iter_mut()
        .find(|round| round.round_id == control.round_id)
        .ok_or("round not found")?;
    if round.revision != control.revision {
        return Err("round changed before it was finished".into());
    }
    if !matches!(round.status, RoundStatus::Answering) {
        return Err("round is no longer waiting for an answer".into());
    }
    if matches!(status, RoundStatus::Completed) && round.entries.iter().any(|entry| !entry.answered)
    {
        return Err("all entries must be answered before replying".into());
    }
    round.status = status;
    Ok(result_for(&control.session_id, round))
}

async fn write_message<W: AsyncWrite + Unpin>(
    writer: &mut W,
    message: &ServerMessage,
) -> Result<(), String> {
    let encoded = serde_json::to_string(message).map_err(|error| error.to_string())?;
    writer
        .write_all(encoded.as_bytes())
        .await
        .map_err(|error| error.to_string())?;
    writer
        .write_all(b"\n")
        .await
        .map_err(|error| error.to_string())?;
    writer.flush().await.map_err(|error| error.to_string())
}

async fn finish_from_socket(
    state: &SharedState,
    hub: &DeliveryHub,
    app: &AppHandle,
    control: RoundControl,
    status: RoundStatus,
) -> Result<RoundResult, String> {
    let result = {
        let mut board = state.lock().await;
        finish_round(&mut board, &control, status)?
    };
    hub.publish(result.clone()).await;
    let _ = app.emit(
        CHANGE_EVENT,
        BoardChange {
            session_id: result.session_id.clone(),
            round_id: result.round_id.clone(),
            status: result.status,
        },
    );
    Ok(result)
}

async fn handle_connection(
    stream: TcpStream,
    state: SharedState,
    hub: DeliveryHub,
    app: AppHandle,
) {
    let (read_half, mut writer) = stream.into_split();
    let mut lines = BufReader::new(read_half).lines();
    let mut heartbeat = interval(Duration::from_secs(20));
    heartbeat.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let mut waiting: Option<oneshot::Receiver<RoundResult>> = None;

    loop {
        tokio::select! {
            line = lines.next_line() => {
                let line = match line {
                    Ok(Some(line)) => line,
                    Ok(None) | Err(_) => break,
                };
                let message: ClientMessage = match serde_json::from_str(&line) {
                    Ok(message) => message,
                    Err(error) => {
                        let _ = write_message(&mut writer, &ServerMessage::Error {
                            protocol: PROTOCOL_VERSION,
                            code: "invalid_json",
                            message: error.to_string(),
                        }).await;
                        continue;
                    }
                };
                match message {
                    ClientMessage::Deliver(request) => {
                        if waiting.is_some() {
                            let _ = write_message(&mut writer, &ServerMessage::Error {
                                protocol: PROTOCOL_VERSION,
                                code: "round_in_progress",
                                message: "this connection is already waiting for a round result".into(),
                            }).await;
                            continue;
                        }
                        let parsed = match request_questions(request) {
                            Ok(parsed) => parsed,
                            Err(error) => {
                                let _ = write_message(&mut writer, &ServerMessage::Error {
                                    protocol: PROTOCOL_VERSION,
                                    code: "invalid_delivery",
                                    message: error,
                                }).await;
                                continue;
                            }
                        };
                        let registration = {
                            let mut board = state.lock().await;
                            register_delivery(&mut board, parsed.0.clone(), parsed.1.clone(), parsed.2, parsed.3)
                        };
                        match registration {
                            Ok(DeliveryRegistration::Waiting { key, revision, status }) => {
                                let receiver = hub.subscribe(key.clone()).await;
                                let _ = app.emit(
                                    CHANGE_EVENT,
                                    BoardChange {
                                        session_id: key.0.clone(),
                                        round_id: key.1.clone(),
                                        status: "answering",
                                    },
                                );
                                if write_message(&mut writer, &ServerMessage::DeliveryAck {
                                    protocol: PROTOCOL_VERSION,
                                    session_id: key.0,
                                    round_id: key.1,
                                    revision,
                                    status,
                                }).await.is_err() {
                                    break;
                                }
                                waiting = Some(receiver);
                            }
                            Ok(DeliveryRegistration::Finished(result)) => {
                                if write_message(&mut writer, &ServerMessage::DeliveryAck {
                                    protocol: PROTOCOL_VERSION,
                                    session_id: result.session_id.clone(),
                                    round_id: result.round_id.clone(),
                                    revision: result.revision,
                                    status: result.status,
                                }).await.is_err() {
                                    break;
                                }
                                if write_message(&mut writer, &ServerMessage::RoundResult {
                                    protocol: result.protocol,
                                    session_id: result.session_id,
                                    round_id: result.round_id,
                                    revision: result.revision,
                                    status: result.status,
                                    answers: result.answers,
                                }).await.is_err() {
                                    break;
                                }
                            }
                            Err(error) => {
                                let _ = write_message(&mut writer, &ServerMessage::Error {
                                    protocol: PROTOCOL_VERSION,
                                    code: "busy",
                                    message: error,
                                }).await;
                            }
                        }
                    }
                    ClientMessage::Cancel { session_id, round_id, revision } => {
                        let control = RoundControl {
                            session_id,
                            round_id,
                            revision: revision.unwrap_or(0),
                        };
                        if waiting.is_none() {
                            if let Ok(result) = finish_from_socket(&state, &hub, &app, control, RoundStatus::Stopped).await {
                                let _ = write_message(&mut writer, &ServerMessage::RoundResult {
                                    protocol: result.protocol,
                                    session_id: result.session_id,
                                    round_id: result.round_id,
                                    revision: result.revision,
                                    status: result.status,
                                    answers: result.answers,
                                }).await;
                            }
                        } else {
                            let _ = finish_from_socket(&state, &hub, &app, control, RoundStatus::Stopped).await;
                        }
                    }
                    ClientMessage::ResultAck { round_id } => {
                        let _ = round_id;
                    }
                    ClientMessage::Pong => {}
                }
            }
            result = async {
                match waiting.as_mut() {
                    Some(receiver) => receiver.await.ok(),
                    None => std::future::pending().await,
                }
            }, if waiting.is_some() => {
                if let Some(result) = result {
                    if write_message(&mut writer, &ServerMessage::RoundResult {
                        protocol: result.protocol,
                        session_id: result.session_id,
                        round_id: result.round_id,
                        revision: result.revision,
                        status: result.status,
                        answers: result.answers,
                    }).await.is_err() {
                        break;
                    }
                }
                waiting = None;
            }
            _ = heartbeat.tick() => {
                if write_message(&mut writer, &ServerMessage::Ping { protocol: PROTOCOL_VERSION }).await.is_err() {
                    break;
                }
            }
        }
    }
}

async fn serve_socket(state: SharedState, hub: DeliveryHub, app: AppHandle) {
    let bind = env::var("ANSWER_BOARD_SOCKET_BIND").unwrap_or_else(|_| DEFAULT_BIND.into());
    let address: SocketAddr = match bind.parse() {
        Ok(address) => address,
        Err(error) => {
            eprintln!("invalid ANSWER_BOARD_SOCKET_BIND {bind:?}: {error}");
            return;
        }
    };
    let listener = match TcpListener::bind(address).await {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("failed to bind Answer Board socket server to {address}: {error}");
            return;
        }
    };
    println!("Answer Board socket listening on {address}");
    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                let next_state = state.clone();
                let next_hub = hub.clone();
                let next_app = app.clone();
                tauri::async_runtime::spawn(handle_connection(
                    stream, next_state, next_hub, next_app,
                ));
            }
            Err(error) => eprintln!("Answer Board socket accept failed: {error}"),
        }
    }
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
    let round_index = board.sessions[session_index]
        .rounds
        .iter()
        .position(|round| round.round_id == payload.round_id)
        .ok_or("round not found")?;
    if board.sessions[session_index].rounds[round_index].revision != payload.revision {
        return Err("round changed before the entries were saved".into());
    }
    if !matches!(
        board.sessions[session_index].rounds[round_index].status,
        RoundStatus::Draft | RoundStatus::Answering
    ) {
        return Err("round is read-only".into());
    }
    if let Some(max_id) = max_id {
        board.next_entry_id = board.next_entry_id.max(max_id.saturating_add(1));
    }
    let mut entries = payload.entries;
    entries.sort_by_key(|entry| entry.number);
    board.sessions[session_index].rounds[round_index].entries = entries;
    Ok(())
}

#[tauri::command]
async fn reply_round(
    payload: RoundControl,
    state: tauri::State<'_, SharedState>,
    hub: tauri::State<'_, DeliveryHub>,
    app: AppHandle,
) -> Result<RoundResult, String> {
    finish_from_socket(&state, &hub, &app, payload, RoundStatus::Completed).await
}

#[tauri::command]
async fn stop_round(
    payload: RoundControl,
    state: tauri::State<'_, SharedState>,
    hub: tauri::State<'_, DeliveryHub>,
    app: AppHandle,
) -> Result<RoundResult, String> {
    finish_from_socket(&state, &hub, &app, payload, RoundStatus::Stopped).await
}

#[tauri::command]
async fn close_session(
    session_id: String,
    state: tauri::State<'_, SharedState>,
    hub: tauri::State<'_, DeliveryHub>,
    app: AppHandle,
) -> Result<(), String> {
    if session_id == LOCAL_ID {
        return Err("the Local session cannot be closed".into());
    }
    let stopped = {
        let mut board = state.lock().await;
        let session = board
            .sessions
            .iter_mut()
            .find(|session| session.id == session_id)
            .ok_or("session not found")?;
        let result = session
            .rounds
            .last_mut()
            .filter(|round| matches!(round.status, RoundStatus::Answering))
            .map(|round| {
                round.status = RoundStatus::Stopped;
                result_for(&session_id, round)
            });
        board.sessions.retain(|session| session.id != session_id);
        result
    };
    if let Some(result) = stopped {
        hub.publish(result.clone()).await;
        let _ = app.emit(
            CHANGE_EVENT,
            BoardChange {
                session_id: result.session_id.clone(),
                round_id: result.round_id.clone(),
                status: "stopped",
            },
        );
    }
    Ok(())
}

#[tauri::command]
fn list_system_fonts() -> Result<Vec<String>, String> {
    #[cfg(target_os = "windows")]
    {
        use std::collections::BTreeMap;
        use winreg::{
            enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE},
            RegKey,
        };
        let mut fonts = BTreeMap::new();
        for root in [
            RegKey::predef(HKEY_LOCAL_MACHINE),
            RegKey::predef(HKEY_CURRENT_USER),
        ] {
            if let Ok(key) =
                root.open_subkey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts")
            {
                for value in key.enum_values().flatten() {
                    let name = value.0;
                    let family = name
                        .split_once(" (")
                        .map_or(name.as_str(), |(family, _)| family)
                        .trim();
                    if !family.is_empty() {
                        fonts
                            .entry(family.to_lowercase())
                            .or_insert_with(|| family.to_string());
                    }
                }
            }
        }
        return Ok(fonts.into_values().collect());
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(Vec::new())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = Arc::new(Mutex::new(BoardState::default()));
    let hub = DeliveryHub::default();
    tauri::Builder::default()
        .manage(state.clone())
        .manage(hub.clone())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            get_sessions,
            replace_entries,
            reply_round,
            stop_round,
            close_session,
            list_system_fonts
        ])
        .setup(move |app| {
            tauri::async_runtime::spawn(serve_socket(
                state.clone(),
                hub.clone(),
                app.handle().clone(),
            ));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn question(number: u32) -> IncomingQuestion {
        IncomingQuestion {
            number,
            body: format!("Question {number}"),
            recommendation: format!("Recommendation {number}"),
        }
    }

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
    fn initial_state_has_only_empty_local_draft() {
        let state = BoardState::default();
        assert_eq!(state.sessions.len(), 1);
        assert!(state.sessions[0].local);
        assert_eq!(state.sessions[0].rounds[0].status, RoundStatus::Draft);
        assert!(state.sessions[0].rounds[0].entries.is_empty());
    }

    #[test]
    fn repeated_round_id_resumes_and_completed_round_replays() {
        let mut state = BoardState::default();
        let first = register_delivery(
            &mut state,
            "agent".into(),
            "round-1".into(),
            None,
            vec![question(1)],
        )
        .unwrap();
        assert!(matches!(
            first,
            DeliveryRegistration::Waiting {
                status: "accepted",
                ..
            }
        ));
        let resumed = register_delivery(
            &mut state,
            "agent".into(),
            "round-1".into(),
            None,
            vec![question(1)],
        )
        .unwrap();
        assert!(matches!(
            resumed,
            DeliveryRegistration::Waiting {
                status: "resumed",
                ..
            }
        ));

        let revision = state.sessions[1].rounds[0].revision;
        state.sessions[1].rounds[0].entries[0].answered = true;
        let result = finish_round(
            &mut state,
            &RoundControl {
                session_id: "agent".into(),
                round_id: "round-1".into(),
                revision,
            },
            RoundStatus::Completed,
        )
        .unwrap();
        assert_eq!(result.status, "completed");
        assert!(matches!(
            register_delivery(
                &mut state,
                "agent".into(),
                "round-1".into(),
                None,
                vec![question(1)]
            )
            .unwrap(),
            DeliveryRegistration::Finished(_)
        ));
    }

    #[test]
    fn different_round_is_busy_while_answering_and_appended_after_completion() {
        let mut state = BoardState::default();
        register_delivery(
            &mut state,
            "agent".into(),
            "round-1".into(),
            None,
            vec![question(1)],
        )
        .unwrap();
        assert!(register_delivery(
            &mut state,
            "agent".into(),
            "round-2".into(),
            None,
            vec![question(2)],
        )
        .is_err());
        let revision = state.sessions[1].rounds[0].revision;
        state.sessions[1].rounds[0].entries[0].answered = true;
        finish_round(
            &mut state,
            &RoundControl {
                session_id: "agent".into(),
                round_id: "round-1".into(),
                revision,
            },
            RoundStatus::Completed,
        )
        .unwrap();
        register_delivery(
            &mut state,
            "agent".into(),
            "round-2".into(),
            None,
            vec![question(2)],
        )
        .unwrap();
        assert_eq!(state.sessions[1].rounds.len(), 2);
    }

    #[test]
    fn completed_round_requires_every_entry_answered_and_stopped_keeps_partial_answers() {
        let mut state = BoardState::default();
        register_delivery(
            &mut state,
            "agent".into(),
            "round-1".into(),
            None,
            vec![question(1), question(2)],
        )
        .unwrap();
        let revision = state.sessions[1].rounds[0].revision;
        assert!(finish_round(
            &mut state,
            &RoundControl {
                session_id: "agent".into(),
                round_id: "round-1".into(),
                revision,
            },
            RoundStatus::Completed,
        )
        .is_err());
        state.sessions[1].rounds[0].entries[0].answered = true;
        state.sessions[1].rounds[0].entries[0].text = "partial".into();
        let result = finish_round(
            &mut state,
            &RoundControl {
                session_id: "agent".into(),
                round_id: "round-1".into(),
                revision,
            },
            RoundStatus::Stopped,
        )
        .unwrap();
        assert_eq!(result.status, "stopped");
        assert_eq!(result.answers[0].text, "partial");
        assert!(!result.answers[1].answered);
    }

    #[test]
    fn round_result_serializes_as_flat_protocol_message() {
        let value = serde_json::to_value(ServerMessage::RoundResult {
            protocol: 1,
            session_id: "agent".into(),
            round_id: "round-1".into(),
            revision: 2,
            status: "completed",
            answers: vec![AnswerResult {
                number: 1,
                text: "ok".into(),
                answered: true,
            }],
        })
        .unwrap();
        assert_eq!(value["type"], "round_result");
        assert_eq!(value["session_id"], "agent");
        assert!(value.get("result").is_none());
    }
}
