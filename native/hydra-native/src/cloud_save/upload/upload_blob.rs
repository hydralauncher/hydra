use napi::bindgen_prelude::Error;
use napi_derive::napi;
use reqwest::header::{HeaderValue, CONTENT_LENGTH};

fn upload_error(error: reqwest::Error) -> Error {
    Error::from_reason(format!(
        "Failed to upload local save file: {}",
        error.without_url()
    ))
}

#[napi]
pub async fn upload_local_save_blob(
    absolute_path: String,
    upload_url: String,
    content_length: String,
    checksum_sha256: String,
) -> napi::Result<()> {
    let expected_size = content_length
        .parse::<u64>()
        .map_err(|_| Error::from_reason("Invalid upload Content-Length"))?;
    let content_length_header = HeaderValue::from_str(&content_length)
        .map_err(|_| Error::from_reason("Invalid upload Content-Length"))?;
    let checksum_header = HeaderValue::from_str(&checksum_sha256)
        .map_err(|_| Error::from_reason("Invalid upload SHA-256 checksum"))?;
    if checksum_sha256.is_empty() {
        return Err(Error::from_reason("Invalid upload SHA-256 checksum"));
    }

    let file = tokio::fs::File::open(&absolute_path)
        .await
        .map_err(|error| Error::from_reason(format!("Failed to open local save file: {error}")))?;
    let metadata = file.metadata().await.map_err(|error| {
        Error::from_reason(format!("Failed to inspect local save file: {error}"))
    })?;
    if !metadata.is_file() {
        return Err(Error::from_reason("Local save path is not a file"));
    }
    if metadata.len() != expected_size {
        return Err(Error::from_reason("cloud_save_upload_source_size_changed"));
    }

    let response = reqwest::Client::new()
        .put(upload_url)
        .header(CONTENT_LENGTH, content_length_header)
        .header("x-amz-checksum-sha256", checksum_header)
        .body(file)
        .send()
        .await
        .map_err(upload_error)?;
    if matches!(response.status().as_u16(), 401 | 403) {
        return Err(Error::from_reason("cloud_save_upload_url_expired"));
    }
    response.error_for_status().map_err(upload_error)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::sync::oneshot;

    use super::*;

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
                let Some(header_end) = request.windows(4).position(|part| part == b"\r\n\r\n")
                else {
                    continue;
                };
                let headers = String::from_utf8_lossy(&request[..header_end]);
                let length = headers.lines().find_map(|line| {
                    line.to_ascii_lowercase()
                        .strip_prefix("content-length:")
                        .and_then(|value| value.trim().parse::<usize>().ok())
                });
                if length.is_some_and(|length| request.len() >= header_end + 4 + length) {
                    break;
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

        upload_local_save_blob(
            path.display().to_string(),
            url,
            content.len().to_string(),
            "checksum==".to_string(),
        )
        .await
        .unwrap();
        request.await.unwrap()
    }

    #[tokio::test]
    async fn streams_empty_and_non_empty_files_with_content_length() {
        for content in [b"".as_slice(), b"save".as_slice()] {
            let request = upload_and_capture(content).await;
            let header_end = request
                .windows(4)
                .position(|part| part == b"\r\n\r\n")
                .unwrap();
            let headers = String::from_utf8_lossy(&request[..header_end]).to_ascii_lowercase();

            assert!(headers.contains(&format!("content-length: {}", content.len())));
            assert!(headers.contains("x-amz-checksum-sha256: checksum=="));
            assert_eq!(&request[header_end + 4..], content);
        }
    }

    #[tokio::test]
    async fn rejects_a_file_that_changed_size_after_prepare() {
        let (url, _) = server(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n").await;
        let directory = tempdir().unwrap();
        let path = directory.path().join("save.dat");
        tokio::fs::write(&path, b"changed").await.unwrap();

        let error = upload_local_save_blob(
            path.display().to_string(),
            url,
            "1".to_string(),
            "checksum==".to_string(),
        )
        .await
        .unwrap_err()
        .to_string();
        assert!(error.contains("cloud_save_upload_source_size_changed"));
    }

    #[tokio::test]
    async fn removes_signed_url_from_http_errors() {
        let (url, _) = server(b"HTTP/1.1 411 Length Required\r\nContent-Length: 0\r\n\r\n").await;
        let directory = tempdir().unwrap();
        let path = directory.path().join("save.dat");
        tokio::fs::write(&path, []).await.unwrap();

        let error = upload_local_save_blob(
            path.display().to_string(),
            url,
            "0".to_string(),
            "checksum==".to_string(),
        )
        .await
        .unwrap_err()
        .to_string();

        assert!(error.contains("411 Length Required"));
        assert!(!error.contains("signature=secret"));
        assert!(!error.contains("http://"));
    }
}
