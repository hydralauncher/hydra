use std::fs;

use rcgen::{date_time_ymd, CertificateParams, DistinguishedName, DnType, KeyPair, PKCS_RSA_SHA256};
use rsa::pkcs8::EncodePrivateKey;

use crate::store::Store;

pub struct Identity {
    pub cert_pem: String,
    pub cert_der: Vec<u8>,
    pub key_pkcs8_der: Vec<u8>,
}

pub fn load_or_generate(store: &Store) -> Result<Identity, String> {
    let cert_path = store.path("cert.pem");
    let key_path = store.path("key.der");

    if cert_path.exists() && key_path.exists() {
        let cert_pem = fs::read_to_string(&cert_path).map_err(|error| error.to_string())?;
        let (_, pem) = x509_parser::pem::parse_x509_pem(cert_pem.as_bytes())
            .map_err(|error| format!("failed to parse {cert_path:?}: {error}"))?;
        let key_pkcs8_der = fs::read(&key_path).map_err(|error| error.to_string())?;
        return Ok(Identity {
            cert_pem,
            cert_der: pem.contents,
            key_pkcs8_der,
        });
    }

    eprintln!("generating self-signed certificate (one-time, may take a few seconds)");
    let mut rng = rsa::rand_core::OsRng;
    let private_key =
        rsa::RsaPrivateKey::new(&mut rng, 2048).map_err(|error| error.to_string())?;
    let key_pkcs8_der = private_key
        .to_pkcs8_der()
        .map_err(|error| error.to_string())?
        .as_bytes()
        .to_vec();

    let key_pair = KeyPair::from_pkcs8_der_and_sign_algo(
        &rustls::pki_types::PrivatePkcs8KeyDer::from(key_pkcs8_der.clone()),
        &PKCS_RSA_SHA256,
    )
    .map_err(|error| error.to_string())?;

    let mut params = CertificateParams::new(vec![]).map_err(|error| error.to_string())?;
    let mut name = DistinguishedName::new();
    name.push(DnType::CommonName, "Hydra GameStream Root");
    params.distinguished_name = name;
    params.not_before = date_time_ymd(2024, 1, 1);
    params.not_after = date_time_ymd(2045, 12, 31);

    let cert = params
        .self_signed(&key_pair)
        .map_err(|error| error.to_string())?;

    let cert_pem = cert.pem();
    fs::write(&cert_path, &cert_pem).map_err(|error| error.to_string())?;
    fs::write(&key_path, &key_pkcs8_der).map_err(|error| error.to_string())?;

    Ok(Identity {
        cert_pem,
        cert_der: cert.der().to_vec(),
        key_pkcs8_der,
    })
}
