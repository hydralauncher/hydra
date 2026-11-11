//! Prints every label key with its English text, for the launcher's English translation file.
//!
//! cargo run --example label_catalog

use serde_json::{Map, Value};

fn main() {
    let catalog: Map<String, Value> = hydra_save_insights::label_catalog()
        .into_iter()
        .map(|(key, text)| (key, Value::String(text)))
        .collect();
    println!("{:#}", Value::Object(catalog));
}
