//! Sending mail over SMTP with lettre (ADR 0007). Only this module touches a mail server.
//! Nothing here logs an address, a subject, a body, a token or the password.

use std::fmt;
use std::net::IpAddr;
use std::time::Duration;

use lettre::message::header::{ContentType, Header, HeaderName, HeaderValue};
use lettre::message::Mailbox;
use lettre::transport::smtp::authentication::Credentials;
use lettre::transport::smtp::client::{Tls, TlsParameters};
use lettre::transport::stub::AsyncStubTransport;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use thiserror::Error;

/// The whole send, greeting included. lettre's own timeout does not cover the greeting.
pub const SEND_LIMIT: Duration = Duration::from_secs(20);
const DEFAULT_DISPLAY_NAME: &str = "HomeGuard";
const SMTPS_PORT: u16 = 465;
const NOT_SET: &str = "Email alerts are off: SMTP_HOST is not set.";

/// Why e-mail is off. The text is one plain line for the start-up log; it names the
/// variable and never its value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SmtpOff(pub String);

impl SmtpOff {
    /// True when nobody tried to set up mail, so the start-up line is not a warning.
    pub fn is_unset(&self) -> bool {
        self.0 == NOT_SET
    }
}

impl fmt::Display for SmtpOff {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TlsMode {
    /// Port 465: TLS from the first byte.
    Implicit,
    /// Any other port: plain start, then STARTTLS is required.
    StartTls,
    Off,
}

impl TlsMode {
    pub fn describe(self) -> &'static str {
        match self {
            Self::Implicit => "TLS",
            Self::StartTls => "STARTTLS",
            Self::Off => "no encryption",
        }
    }
}

#[derive(Clone)]
pub struct SmtpSettings {
    pub host: String,
    pub port: u16,
    pub login: Option<(String, String)>,
    pub from: Mailbox,
    pub tls: TlsMode,
    /// Public address of the web app, without a trailing slash.
    pub app_url: String,
}

// The password must never reach a log line.
impl fmt::Debug for SmtpSettings {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SmtpSettings")
            .field("host", &self.host)
            .field("port", &self.port)
            .field("login", &self.login.as_ref().map(|_| "<redacted>"))
            .field("from", &"<redacted>")
            .field("tls", &self.tls)
            .field("app_url", &self.app_url)
            .finish()
    }
}

impl SmtpSettings {
    /// `Err` means e-mail stays off; the worker still runs.
    pub fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Result<Self, SmtpOff> {
        let value = |name: &str| {
            get(name)
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
        };
        let off = |text: &str| Err(SmtpOff(format!("Email alerts are off: {text}")));

        let Some(host) = value("SMTP_HOST") else {
            return Err(SmtpOff(NOT_SET.to_string()));
        };
        let port = match value("SMTP_PORT") {
            None => return off("SMTP_PORT is not set."),
            Some(text) => match text.parse::<u16>() {
                Ok(port) if port > 0 => port,
                _ => return off("SMTP_PORT must be a number from 1 to 65535."),
            },
        };
        let login = match (
            value("SMTP_USER"),
            get("SMTP_PASSWORD").filter(|v| !v.is_empty()),
        ) {
            (Some(user), Some(password)) => Some((user, password)),
            (None, None) => None,
            _ => return off("set both SMTP_USER and SMTP_PASSWORD, or neither."),
        };
        let Some(from_text) = value("SMTP_FROM") else {
            return off("SMTP_FROM is not set.");
        };
        let Ok(from) = from_text.parse::<Mailbox>() else {
            return off(
                "SMTP_FROM is not a valid address. Use name <address> or just the address.",
            );
        };
        let from = if from.name.is_some() {
            from
        } else {
            Mailbox::new(Some(DEFAULT_DISPLAY_NAME.to_string()), from.email)
        };
        let tls = match value("SMTP_TLS").map(|v| v.to_ascii_lowercase()).as_deref() {
            None | Some("on") if port == SMTPS_PORT => TlsMode::Implicit,
            None | Some("on") => TlsMode::StartTls,
            Some("off") => TlsMode::Off,
            Some(_) => return off("SMTP_TLS must be on or off."),
        };
        if tls == TlsMode::Off && login.is_some() && !is_local_address(&host) {
            return off(
                "SMTP_USER and SMTP_PASSWORD need encryption. SMTP_TLS=off with a login is only \
                 allowed when SMTP_HOST is a loopback or private IP address.",
            );
        }
        let Some(app_url) = value("APP_URL").and_then(|u| clean_app_url(&u)) else {
            return off("APP_URL must be an http or https address.");
        };
        Ok(Self {
            host,
            port,
            login,
            from,
            tls,
            app_url,
        })
    }

    /// The line logged once at start.
    pub fn start_line(&self) -> String {
        format!(
            "Email alerts are on: sending through {}:{} with {}.",
            self.host,
            self.port,
            self.tls.describe()
        )
    }
}

/// A password sent without TLS must at least stay on the home network. Only IP addresses
/// count: a host name could point anywhere.
fn is_local_address(host: &str) -> bool {
    let Ok(ip) = host.trim_matches(['[', ']']).parse::<IpAddr>() else {
        return false;
    };
    match ip {
        IpAddr::V4(v4) => v4.is_loopback() || v4.is_private() || v4.is_link_local(),
        IpAddr::V6(v6) => v6.is_loopback() || v6.is_unique_local() || v6.is_unicast_link_local(),
    }
}

fn clean_app_url(text: &str) -> Option<String> {
    let url = text.trim_end_matches('/');
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))?;
    (!rest.is_empty() && !rest.contains(char::is_whitespace)).then(|| url.to_string())
}

#[derive(Debug, Error)]
pub enum MailError {
    #[error("the recipient address is not valid")]
    BadAddress,
    #[error("the message could not be built")]
    Build,
    #[error("the mail server did not finish in time")]
    TimedOut,
    #[error("the mail server refused the mail (code {code})", code = code_text(*.code))]
    Refused { code: Option<u16>, permanent: bool },
    #[error("could not talk to the mail server")]
    Connection,
}

fn code_text(code: Option<u16>) -> String {
    code.map_or_else(|| "unknown".to_string(), |c| c.to_string())
}

pub struct OutgoingMail {
    pub to: String,
    pub subject: String,
    pub body: String,
    /// Used for the `Message-ID` (`<id@from-domain>`).
    pub message_id: String,
    /// Absolute one-click URL for the `List-Unsubscribe` header.
    pub unsubscribe_url: String,
}

#[derive(Clone)]
struct ListUnsubscribe(String);

impl Header for ListUnsubscribe {
    fn name() -> HeaderName {
        HeaderName::new_from_ascii_str("List-Unsubscribe")
    }
    fn parse(s: &str) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        Ok(Self(s.to_string()))
    }
    fn display(&self) -> HeaderValue {
        HeaderValue::new(Self::name(), self.0.clone())
    }
}

#[derive(Clone)]
struct ListUnsubscribePost;

impl Header for ListUnsubscribePost {
    fn name() -> HeaderName {
        HeaderName::new_from_ascii_str("List-Unsubscribe-Post")
    }
    fn parse(_: &str) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        Ok(Self)
    }
    fn display(&self) -> HeaderValue {
        HeaderValue::new(Self::name(), "List-Unsubscribe=One-Click".to_string())
    }
}

enum Transport {
    Smtp(AsyncSmtpTransport<Tokio1Executor>),
    /// Built only by tests.
    Stub(AsyncStubTransport),
}

pub struct Mailer {
    transport: Transport,
    from: Mailbox,
    limit: Duration,
}

impl Mailer {
    pub fn smtp(settings: &SmtpSettings) -> Result<Self, MailError> {
        Self::smtp_with_limit(settings, SEND_LIMIT)
    }

    /// A shorter limit lets tests prove the timeout without waiting 20 s.
    pub fn smtp_with_limit(settings: &SmtpSettings, limit: Duration) -> Result<Self, MailError> {
        let host = settings.host.as_str();
        let builder = match settings.tls {
            TlsMode::Off => AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(host),
            TlsMode::Implicit => {
                let tls = TlsParameters::new(host.into()).map_err(|_| MailError::Connection)?;
                AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(host).tls(Tls::Wrapper(tls))
            }
            TlsMode::StartTls => {
                let tls = TlsParameters::new(host.into()).map_err(|_| MailError::Connection)?;
                AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(host)
                    .tls(Tls::Required(tls))
            }
        };
        let mut builder = builder.port(settings.port).timeout(Some(limit));
        if let Some((user, password)) = &settings.login {
            builder = builder.credentials(Credentials::new(user.clone(), password.clone()));
        }
        Ok(Self {
            transport: Transport::Smtp(builder.build()),
            from: settings.from.clone(),
            limit,
        })
    }

    pub fn stub(from: Mailbox, transport: AsyncStubTransport) -> Self {
        Self {
            transport: Transport::Stub(transport),
            from,
            limit: SEND_LIMIT,
        }
    }

    pub fn from_domain(&self) -> &str {
        self.from.email.domain()
    }

    pub async fn send(&self, mail: &OutgoingMail) -> Result<(), MailError> {
        let message = self.build_message(mail)?;
        let sending = async {
            match &self.transport {
                Transport::Smtp(smtp) => smtp.send(message).await.map(|_| ()).map_err(smtp_error),
                Transport::Stub(stub) => {
                    stub.send(message)
                        .await
                        .map(|_| ())
                        .map_err(|_| MailError::Refused {
                            code: None,
                            permanent: false,
                        })
                }
            }
        };
        tokio::time::timeout(self.limit, sending)
            .await
            .map_err(|_| MailError::TimedOut)?
    }

    fn build_message(&self, mail: &OutgoingMail) -> Result<Message, MailError> {
        let to: Mailbox = mail.to.parse().map_err(|_| MailError::BadAddress)?;
        Message::builder()
            .from(self.from.clone())
            .to(to)
            .subject(mail.subject.clone())
            .message_id(Some(format!(
                "<{}@{}>",
                mail.message_id,
                self.from_domain()
            )))
            .date_now()
            .header(ListUnsubscribe(format!("<{}>", mail.unsubscribe_url)))
            .header(ListUnsubscribePost)
            .header(ContentType::TEXT_PLAIN)
            .body(mail.body.clone())
            .map_err(|_| MailError::Build)
    }
}

fn smtp_error(err: lettre::transport::smtp::Error) -> MailError {
    if err.is_permanent() || err.is_transient() {
        let code = err.status().and_then(|c| c.to_string().parse::<u16>().ok());
        MailError::Refused {
            code,
            permanent: err.is_permanent(),
        }
    } else {
        MailError::Connection
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lookup(pairs: &'static [(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> {
        move |name| {
            pairs
                .iter()
                .find(|(k, _)| *k == name)
                .map(|(_, v)| v.to_string())
        }
    }

    const VALID: &[(&str, &str)] = &[
        ("SMTP_HOST", "mail.example.com"),
        ("SMTP_PORT", "587"),
        ("SMTP_FROM", "alerts@example.com"),
        ("APP_URL", "http://localhost:3000/"),
    ];

    fn with(extra: &'static [(&'static str, &'static str)]) -> Result<SmtpSettings, SmtpOff> {
        let mut pairs: Vec<(&str, &str)> = VALID.to_vec();
        for (k, v) in extra {
            pairs.retain(|(name, _)| name != k);
            pairs.push((k, v));
        }
        let owned: Vec<(String, String)> = pairs
            .into_iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        SmtpSettings::from_lookup(move |name| {
            owned
                .iter()
                .find(|(k, _)| k == name)
                .map(|(_, v)| v.clone())
        })
    }

    fn off_text(result: Result<SmtpSettings, SmtpOff>) -> String {
        result.unwrap_err().to_string()
    }

    #[test]
    fn no_host_means_email_is_off() {
        let result = SmtpSettings::from_lookup(lookup(&[]));
        assert_eq!(
            off_text(result),
            "Email alerts are off: SMTP_HOST is not set."
        );
    }

    #[test]
    fn a_missing_port_names_the_variable() {
        let result = SmtpSettings::from_lookup(lookup(&[("SMTP_HOST", "h")]));
        assert!(off_text(result).contains("SMTP_PORT"));
    }

    #[test]
    fn a_port_out_of_range_is_refused() {
        assert!(off_text(with(&[("SMTP_PORT", "70000")])).contains("SMTP_PORT"));
        assert!(off_text(with(&[("SMTP_PORT", "0")])).contains("SMTP_PORT"));
        assert!(off_text(with(&[("SMTP_PORT", "abc")])).contains("SMTP_PORT"));
    }

    #[test]
    fn a_missing_or_bad_from_names_the_variable() {
        assert!(off_text(with(&[("SMTP_FROM", "")])).contains("SMTP_FROM"));
        assert!(off_text(with(&[("SMTP_FROM", "not an address")])).contains("SMTP_FROM"));
    }

    #[test]
    fn user_without_password_is_refused_and_so_is_the_reverse() {
        let message = "Email alerts are off: set both SMTP_USER and SMTP_PASSWORD, or neither.";
        assert_eq!(off_text(with(&[("SMTP_USER", "me")])), message);
        assert_eq!(off_text(with(&[("SMTP_PASSWORD", "pw")])), message);
    }

    #[test]
    fn user_and_password_together_are_accepted() {
        let settings = with(&[("SMTP_USER", "me"), ("SMTP_PASSWORD", "pw")]).unwrap();
        assert!(settings.login.is_some());
    }

    #[test]
    fn port_465_uses_implicit_tls_and_others_starttls() {
        assert_eq!(
            with(&[("SMTP_PORT", "465")]).unwrap().tls,
            TlsMode::Implicit
        );
        assert_eq!(
            with(&[("SMTP_PORT", "587")]).unwrap().tls,
            TlsMode::StartTls
        );
        assert_eq!(with(&[("SMTP_PORT", "25")]).unwrap().tls, TlsMode::StartTls);
    }

    #[test]
    fn smtp_tls_off_turns_encryption_off() {
        assert_eq!(with(&[("SMTP_TLS", "off")]).unwrap().tls, TlsMode::Off);
        assert_eq!(with(&[("SMTP_TLS", "ON")]).unwrap().tls, TlsMode::StartTls);
    }

    #[test]
    fn a_login_without_encryption_is_refused_for_a_public_host() {
        let login = [
            ("SMTP_USER", "me"),
            ("SMTP_PASSWORD", "pw"),
            ("SMTP_TLS", "off"),
        ];
        for host in ["mail.example.com", "8.8.8.8", "localhost"] {
            let mut pairs = login.to_vec();
            pairs.push(("SMTP_HOST", host));
            let text = off_text(with(Box::leak(pairs.into_boxed_slice())));
            assert!(text.contains("SMTP_TLS=off"), "{host}: {text}");
        }
    }

    #[test]
    fn a_login_without_encryption_is_allowed_for_loopback_and_private_ips() {
        let login = [
            ("SMTP_USER", "me"),
            ("SMTP_PASSWORD", "pw"),
            ("SMTP_TLS", "off"),
        ];
        for host in [
            "127.0.0.1",
            "192.168.1.5",
            "10.0.0.2",
            "172.16.0.9",
            "::1",
            "fd00::5",
        ] {
            let mut pairs = login.to_vec();
            pairs.push(("SMTP_HOST", host));
            let settings = with(Box::leak(pairs.into_boxed_slice())).unwrap();
            assert!(settings.login.is_some(), "{host}");
        }
    }

    #[test]
    fn no_login_without_encryption_is_allowed_for_any_host() {
        assert_eq!(with(&[("SMTP_TLS", "off")]).unwrap().tls, TlsMode::Off);
    }

    #[test]
    fn another_smtp_tls_value_is_refused() {
        assert!(off_text(with(&[("SMTP_TLS", "maybe")])).contains("SMTP_TLS"));
    }

    #[test]
    fn the_app_url_must_be_http_or_https_and_loses_its_trailing_slash() {
        assert_eq!(with(&[]).unwrap().app_url, "http://localhost:3000");
        assert!(off_text(with(&[("APP_URL", "ftp://x")])).contains("APP_URL"));
        assert!(off_text(with(&[("APP_URL", "")])).contains("APP_URL"));
    }

    #[test]
    fn a_bare_address_gets_the_display_name_homeguard() {
        let settings = with(&[]).unwrap();
        assert_eq!(settings.from.name.as_deref(), Some("HomeGuard"));
    }

    #[test]
    fn a_display_name_in_smtp_from_is_kept() {
        let settings = with(&[("SMTP_FROM", "Home Alerts <a@example.com>")]).unwrap();
        assert_eq!(settings.from.name.as_deref(), Some("Home Alerts"));
    }

    #[test]
    fn debug_output_hides_the_password_and_the_user() {
        let settings = with(&[("SMTP_USER", "me-user"), ("SMTP_PASSWORD", "s3cret-pw")]).unwrap();
        let text = format!("{settings:?}");
        assert!(!text.contains("s3cret-pw") && !text.contains("me-user"));
    }

    #[test]
    fn the_start_line_names_host_port_and_encryption_but_no_secret() {
        let settings = with(&[("SMTP_USER", "me"), ("SMTP_PASSWORD", "s3cret-pw")]).unwrap();
        assert_eq!(
            settings.start_line(),
            "Email alerts are on: sending through mail.example.com:587 with STARTTLS."
        );
    }

    fn stub_mailer() -> (Mailer, AsyncStubTransport) {
        let stub = AsyncStubTransport::new_ok();
        let from: Mailbox = "HomeGuard <alerts@example.com>".parse().unwrap();
        (Mailer::stub(from, stub.clone()), stub)
    }

    fn mail() -> OutgoingMail {
        OutgoingMail {
            to: "me@example.com".into(),
            subject: "Hello".into(),
            body: "Body\r\n".into(),
            message_id: "abc".into(),
            unsubscribe_url:
                "http://localhost:3000/api/notifications/unsubscribe/one-click?token=t".into(),
        }
    }

    #[tokio::test]
    async fn the_stub_records_a_message_with_the_unsubscribe_headers() {
        let (mailer, stub) = stub_mailer();
        mailer.send(&mail()).await.unwrap();
        let sent = stub.messages().await;
        assert_eq!(sent.len(), 1);
        let raw = &sent[0].1;
        assert!(raw.contains("List-Unsubscribe: <http://localhost:3000/api/notifications/unsubscribe/one-click?token=t>"));
        assert!(raw.contains("List-Unsubscribe-Post: List-Unsubscribe=One-Click"));
        assert!(raw.contains("Message-ID: <abc@example.com>"));
        assert!(raw.contains("From: HomeGuard <alerts@example.com>"));
    }

    #[tokio::test]
    async fn a_bad_recipient_is_refused_before_sending() {
        let (mailer, stub) = stub_mailer();
        let mut bad = mail();
        bad.to = "not an address".into();
        assert!(matches!(
            mailer.send(&bad).await,
            Err(MailError::BadAddress)
        ));
        assert!(stub.messages().await.is_empty());
    }

    #[tokio::test]
    async fn the_error_text_has_no_address() {
        let (mailer, _) = stub_mailer();
        let mut bad = mail();
        bad.to = "secret-person".into();
        let err = mailer.send(&bad).await.unwrap_err();
        assert!(!err.to_string().contains("secret-person"));
    }
}
