use std::sync::OnceLock;
use std::time::Duration;

const BLOB_CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
const BLOB_READ_TIMEOUT: Duration = Duration::from_secs(60);
const BLOB_TOTAL_TIMEOUT: Duration = Duration::from_secs(4 * 60 * 60);

static BLOB_HTTP_CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();
static CRYPTO_PROVIDER: OnceLock<()> = OnceLock::new();

pub(crate) fn ensure_crypto_provider() {
    CRYPTO_PROVIDER.get_or_init(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

pub(crate) fn build_blob_http_client(
    connect_timeout: Duration,
    read_timeout: Duration,
    total_timeout: Duration,
) -> Result<reqwest::Client, String> {
    ensure_crypto_provider();

    reqwest::Client::builder()
        .connect_timeout(connect_timeout)
        .read_timeout(read_timeout)
        .timeout(total_timeout)
        .build()
        .map_err(|error| format!("Failed to build cloud save transfer HTTP client: {error}"))
}

pub(crate) fn blob_http_client() -> Result<&'static reqwest::Client, String> {
    BLOB_HTTP_CLIENT
        .get_or_init(|| {
            build_blob_http_client(BLOB_CONNECT_TIMEOUT, BLOB_READ_TIMEOUT, BLOB_TOTAL_TIMEOUT)
        })
        .as_ref()
        .map_err(Clone::clone)
}
