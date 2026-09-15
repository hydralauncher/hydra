use std::sync::Arc;

use serde::Deserialize;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;

use hydra_stream::config;
use hydra_stream::control;
use hydra_stream::http;
use hydra_stream::mdns;
use hydra_stream::nvhttp::State;
use hydra_stream::rtsp;


#[derive(Deserialize)]
struct RpcRequest {
    id: Value,
    method: String,
    params: Option<Value>,
}

#[tokio::main]
async fn main() {
    let mut out = tokio::io::stdout();

    let handshake = format!("{}\n", json!({ "event": "ready", "protocolVersion": 1 }));
    if out.write_all(handshake.as_bytes()).await.is_err() {
        eprintln!("failed to write handshake");
        return;
    }
    if out.flush().await.is_err() {
        eprintln!("failed to flush handshake");
        return;
    }

    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<String>();

    let state = match State::load(event_tx) {
        Ok(state) => Arc::new(state),
        Err(error) => {
            eprintln!("failed to initialize: {error}");
            return;
        }
    };

    if let Err(error) = mdns::start(&state.uuid) {
        eprintln!("failed to start mDNS advertiser: {error}");
    }

    // Recovery-capability probe at startup: DESCRIBE advertises reference-
    // frame invalidation before the session's encoder exists, so the
    // throwaway probe session is created once here (Sunshine's
    // video::probe_encoders runs at startup for the same reason) instead of
    // on the first RTSP request.
    let recovery = hydra_stream::capture::probe_recovery_capability();
    eprintln!(
        "video: recovery capability probed: ref-pic-invalidation={} max-ref-frames={}",
        recovery.rfi, recovery.ref_frames
    );

    {
        let state = state.clone();
        tokio::spawn(async move {
            let port = config::ports().http;
            if let Err(error) = http::serve(state, port, None).await {
                eprintln!("HTTP server failed: {error}");
            }
        });
    }
    match http::tls_acceptor(&state) {
        Ok(acceptor) => {
            let state = state.clone();
            tokio::spawn(async move {
                let port = config::ports().https;
                if let Err(error) = http::serve(state, port, Some(acceptor)).await {
                    eprintln!("HTTPS server failed: {error}");
                }
            });
        }
        Err(error) => eprintln!("failed to set up TLS: {error}"),
    }
    {
        let state = state.clone();
        tokio::spawn(async move {
            let port = config::ports().rtsp;
            if let Err(error) = rtsp::serve(state, port).await {
                eprintln!("RTSP server failed: {error}");
            }
        });
    }
    if let Err(error) = control::serve(state.clone(), config::ports().control) {
        eprintln!("failed to start control server: {error}");
    }
    {
        let state = state.clone();
        tokio::spawn(async move {
            let launch_timeout_ms: u64 = std::env::var(config::LAUNCH_TIMEOUT_ENV)
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(config::LAUNCH_TIMEOUT_DEFAULT_MS);
            let launch_timeout = std::time::Duration::from_millis(launch_timeout_ms);
            let mut interval = tokio::time::interval(std::time::Duration::from_millis(500));
            loop {
                interval.tick().await;
                state.expire_session(launch_timeout);
            }
        });
    }

    let stdin = BufReader::new(tokio::io::stdin());
    let mut lines = stdin.lines();

    loop {
        tokio::select! {
            line = lines.next_line() => {
                let line = match line {
                    Ok(Some(line)) => line,
                    Ok(None) => break,
                    Err(error) => {
                        eprintln!("failed to read stdin: {error}");
                        break;
                    }
                };

                let request = match serde_json::from_str::<RpcRequest>(&line) {
                    Ok(request) => request,
                    Err(error) => {
                        eprintln!("ignoring malformed line: {error}");
                        continue;
                    }
                };

                let result = match request.method.as_str() {
                    "ping" => "pong".to_string(),
                    "setAppList" => {
                        let apps = request
                            .params
                            .as_ref()
                            .and_then(|params| params.get("apps"))
                            .and_then(|apps| apps.as_array())
                            .map(|apps| {
                                apps.iter()
                                    .filter_map(|app| {
                                        let appid = app.get("appid")?.as_u64()? as u32;
                                        let title = app.get("title")?.as_str()?.to_string();
                                        let cover = app
                                            .get("coverPath")
                                            .and_then(|path| path.as_str())
                                            .map(str::to_string);
                                        Some((appid, title, cover))
                                    })
                                    .collect::<Vec<(u32, String, Option<String>)>>()
                            })
                            .unwrap_or_default();
                        state.set_app_list(apps);
                        "ok".to_string()
                    }
                    "setRunningGame" => {
                        // The launcher's process watcher owns this value: the
                        // appid of the game process it sees running (absent,
                        // null or 0 clears it). It is deliberately not
                        // validated against the catalog, which may still be
                        // syncing.
                        let appid = request
                            .params
                            .as_ref()
                            .and_then(|params| params.get("appid"))
                            .and_then(|appid| appid.as_u64())
                            .unwrap_or(0) as u32;
                        state.set_running_appid(appid);
                        "ok".to_string()
                    }
                    "submitPairingPin" => {
                        let pin = request
                            .params
                            .as_ref()
                            .and_then(|params| params.get("pin"))
                            .and_then(|pin| pin.as_str())
                            .unwrap_or("");
                        match state.submit_pairing_pin(pin) {
                            Ok(_) => "ok".to_string(),
                            Err(hydra_stream::nvhttp::SubmitPinError::InvalidPin) => "invalid-pin".to_string(),
                            Err(hydra_stream::nvhttp::SubmitPinError::NoSession) => "no-session".to_string(),
                        }
                    }
                    other => {
                        eprintln!("ignoring unsupported method: {other}");
                        continue;
                    }
                };

                let response = format!("{}\n", json!({ "id": request.id, "result": result }));
                if out.write_all(response.as_bytes()).await.is_err() {
                    eprintln!("failed to write response");
                    break;
                }
                if out.flush().await.is_err() {
                    eprintln!("failed to flush response");
                    break;
                }
            }
            event = event_rx.recv() => {
                let Some(event) = event else {
                    break;
                };
                let event = format!("{event}\n");
                if out.write_all(event.as_bytes()).await.is_err() {
                    eprintln!("failed to write event");
                    break;
                }
                if out.flush().await.is_err() {
                    eprintln!("failed to flush event");
                    break;
                }
            }
        }
    }
}
