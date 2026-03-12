use assert_cmd::Command;
use chrono::DateTime;

fn assert_version_output(stdout: &str) {
  let output = stdout.trim_end();
  let expected_prefix = format!(
    "{} {} (built ",
    env!("CARGO_PKG_NAME"),
    env!("CARGO_PKG_VERSION")
  );
  assert!(
    output.starts_with(&expected_prefix),
    "unexpected version output: {output}"
  );
  assert!(
    output.ends_with(')'),
    "missing closing parenthesis: {output}"
  );

  let timestamp = &output[expected_prefix.len()..output.len() - 1];
  DateTime::parse_from_str(timestamp, "%Y-%m-%dT%H:%M:%S%:z")
    .unwrap_or_else(|err| panic!("invalid timestamp `{timestamp}`: {err}"));
}

#[test]
fn version_long_flag_prints_local_build_timestamp() {
  let output = Command::cargo_bin(env!("CARGO_PKG_NAME"))
    .unwrap()
    .arg("--version")
    .assert()
    .success()
    .get_output()
    .stdout
    .clone();

  let stdout = String::from_utf8(output).unwrap();
  assert_version_output(&stdout);
}

#[test]
fn version_short_flag_prints_local_build_timestamp() {
  let output = Command::cargo_bin(env!("CARGO_PKG_NAME"))
    .unwrap()
    .arg("-V")
    .assert()
    .success()
    .get_output()
    .stdout
    .clone();

  let stdout = String::from_utf8(output).unwrap();
  assert_version_output(&stdout);
}

#[test]
fn version_flag_takes_priority_over_other_flags() {
  let output = Command::cargo_bin(env!("CARGO_PKG_NAME"))
    .unwrap()
    .args(["--version", "--help"])
    .assert()
    .success()
    .get_output()
    .stdout
    .clone();

  let stdout = String::from_utf8(output).unwrap();
  assert_version_output(&stdout);
}
