use chrono::Utc;

fn main() {
  let build_timestamp_utc = Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
  println!("cargo:rustc-env=BUILD_TIMESTAMP_UTC={build_timestamp_utc}");
  println!("cargo:rerun-if-changed=build.rs");
}
