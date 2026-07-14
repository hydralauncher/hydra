use napi::bindgen_prelude::Error;
use napi_derive::napi;
use reqwest::header::CONTENT_LENGTH;

#[napi]
pub async fn upload_local_save_blob(absolute_path: String, upload_url: String) -> napi::Result<()> {
    let content = tokio::fs::read(&absolute_path)
        .await
        .map_err(|error| Error::from_reason(format!("Failed to read local save file: {error}")))?;
    let response = reqwest::Client::new()
        .put(upload_url)
        .header(CONTENT_LENGTH, content.len())
        .body(content)
        .send()
        .await
        .map_err(|error| {
            Error::from_reason(format!(
                "Failed to upload local save file: {}",
                error.without_url()
            ))
        })?;

    response.error_for_status().map_err(|error| {
        Error::from_reason(format!(
            "Failed to upload local save file: {}",
            error.without_url()
        ))
    })?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::sync::oneshot;

    async fn server(response: &'static [u8]) -> (String, oneshot::Receiver<Vec<u8>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (sender, receiver) = oneshot::channel();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut buffer = [0_u8; 1024];

            loop {
                let read = stream.read(&mut buffer).await.unwrap();
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&buffer[..read]);
                if let Some(header_end) = request.windows(4).position(|part| part == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&request[..header_end]);
                    let content_length = headers
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .and_then(|value| value.trim().parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    if request.len() >= header_end + 4 + content_length {
                        break;
                    }
                }
            }

            let _ = sender.send(request);
            stream.write_all(response).await.unwrap();
        });
        (format!("http://{address}/blob?signature=secret"), receiver)
    }

    async fn upload_and_capture(content: &[u8]) -> Vec<u8> {
        let (url, request) = server(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n").await;
        let directory = tempdir().unwrap();
        let path = directory.path().join("save.dat");
        tokio::fs::write(&path, content).await.unwrap();

        upload_local_save_blob(path.display().to_string(), url)
            .await
            .unwrap();

        request.await.unwrap()
    }

    #[tokio::test]
    async fn sends_explicit_content_length_for_empty_and_non_empty_files() {
        for content in [b"".as_slice(), b"save".as_slice()] {
            let request = upload_and_capture(content).await;
            let header_end = request
                .windows(4)
                .position(|part| part == b"\r\n\r\n")
                .unwrap();
            let headers = String::from_utf8_lossy(&request[..header_end]).to_ascii_lowercase();

            assert!(headers.contains(&format!("content-length: {}", content.len())));
            assert_eq!(&request[header_end + 4..], content);
        }
    }

    #[tokio::test]
    async fn removes_signed_url_from_http_errors() {
        let (url, _) = server(b"HTTP/1.1 411 Length Required\r\nContent-Length: 0\r\n\r\n").await;
        let directory = tempdir().unwrap();
        let path = directory.path().join("save.dat");
        tokio::fs::write(&path, []).await.unwrap();

        let error = upload_local_save_blob(path.display().to_string(), url)
            .await
            .unwrap_err()
            .to_string();

        assert!(error.contains("411 Length Required"));
        assert!(!error.contains("signature=secret"));
        assert!(!error.contains("http://"));
    }
}
