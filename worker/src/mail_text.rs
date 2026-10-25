//! The words of every mail. A pure builder: no database, no network.
//! Text comes from `docs/design/notifications.md` section 5. Plain text only, wrapped at
//! 72 columns where the text is free-form. Links sit on their own line and are never wrapped.

use chrono::{DateTime, Local, Utc};

use crate::status::RiskLevel;

pub const CONFIRM_PATH: &str = "/notifications/confirm?token=";
pub const UNSUBSCRIBE_PATH: &str = "/notifications/unsubscribe?token=";
pub const ONE_CLICK_PATH: &str = "/api/notifications/unsubscribe/one-click?token=";

const WIDTH: usize = 72;
const MAX_SUBJECT_CHARS: usize = 120;
const MAX_SUMMARY_CHARS: usize = 200;
const INSTANT_LISTED: usize = 5;
const DIGEST_DEVICES: usize = 20;
const DIGEST_PROBLEMS_PER_DEVICE: usize = 5;

pub fn confirm_url(app_url: &str, token: &str) -> String {
    format!("{app_url}{CONFIRM_PATH}{token}")
}

pub fn unsubscribe_url(app_url: &str, token: &str) -> String {
    format!("{app_url}{UNSUBSCRIBE_PATH}{token}")
}

pub fn one_click_url(app_url: &str, token: &str) -> String {
    format!("{app_url}{ONE_CLICK_PATH}{token}")
}

fn device_url(app_url: &str, device_id: &str) -> String {
    format!("{app_url}/devices/{device_id}")
}

/// One open finding, already joined with its product and vulnerability.
#[derive(Debug, Clone)]
pub struct Problem {
    pub level: RiskLevel,
    pub product: String,
    pub summary: String,
    pub fixed_version: Option<String>,
    pub exploited: bool,
}

#[derive(Debug, Clone)]
pub struct DeviceBlock {
    pub id: String,
    pub name: String,
    pub last_checked: Option<DateTime<Utc>>,
    pub problems: Vec<Problem>,
}

#[derive(Debug, Clone)]
pub enum MailContent {
    Confirm { confirm_url: String },
    Test,
    Instant { devices: Vec<DeviceBlock> },
    Digest { devices: Vec<DeviceBlock> },
}

#[derive(Debug, Clone)]
pub struct MailInput {
    /// Public address of the web app, without a trailing slash.
    pub app_url: String,
    /// The page link for the footer.
    pub unsubscribe_url: String,
    pub content: MailContent,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BuiltMail {
    pub subject: String,
    pub body: String,
}

pub fn build(input: &MailInput) -> BuiltMail {
    let (subject, text) = match &input.content {
        MailContent::Confirm { confirm_url } => confirm_mail(confirm_url),
        MailContent::Test => test_mail(&input.app_url),
        MailContent::Instant { devices } => instant_mail(&input.app_url, devices),
        MailContent::Digest { devices } => digest_mail(&input.app_url, devices),
    };
    BuiltMail {
        subject: clean_subject(&subject),
        body: format!("{text}\n{}", footer(&input.unsubscribe_url)),
    }
}

fn footer(unsubscribe_url: &str) -> String {
    format!(
        "--\n\
         We only email about new problems. No email does not mean a device is safe.\n\
         \n\
         You get these emails because you turned on email alerts in HomeGuard.\n\
         Stop them: {unsubscribe_url}\n"
    )
}

// ---------- Small text helpers ----------

/// One line of plain text: control characters and line breaks become spaces.
pub fn plain(text: &str) -> String {
    let spaced: String = text
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    spaced.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// A subject has no line breaks and at most 120 characters.
pub fn clean_subject(text: &str) -> String {
    let line = plain(text);
    if line.chars().count() <= MAX_SUBJECT_CHARS {
        return line;
    }
    let cut: String = line.chars().take(MAX_SUBJECT_CHARS - 3).collect();
    format!("{}...", cut.trim_end())
}

/// The first sentence of an NVD summary, cut at 200 characters.
fn one_line_summary(summary: &str) -> String {
    let line = plain(summary);
    let first = line
        .find(". ")
        .map_or(line.as_str(), |end| &line[..=end])
        .to_string();
    if first.chars().count() <= MAX_SUMMARY_CHARS {
        return first;
    }
    let cut: String = first.chars().take(MAX_SUMMARY_CHARS - 3).collect();
    format!("{}...", cut.trim_end())
}

/// Greedy word wrap. `indent` is put before every line.
fn wrap(text: &str, indent: &str) -> String {
    let mut lines: Vec<String> = Vec::new();
    let mut current = String::new();
    for word in text.split_whitespace() {
        let needed = indent.len() + current.chars().count() + 1 + word.chars().count();
        if !current.is_empty() && needed > WIDTH {
            lines.push(format!("{indent}{current}"));
            current.clear();
        }
        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(word);
    }
    if !current.is_empty() {
        lines.push(format!("{indent}{current}"));
    }
    lines.join("\n")
}

fn plural<'a>(count: usize, one: &'a str, many: &'a str) -> &'a str {
    if count == 1 {
        one
    } else {
        many
    }
}

fn level_word(level: RiskLevel) -> &'static str {
    match level {
        RiskLevel::Critical => "Critical",
        RiskLevel::Vulnerable => "Vulnerable",
        RiskLevel::Low => "Low",
    }
}

fn rank(level: RiskLevel) -> u8 {
    match level {
        RiskLevel::Critical => 0,
        RiskLevel::Vulnerable => 1,
        RiskLevel::Low => 2,
    }
}

fn worst(device: &DeviceBlock) -> Option<RiskLevel> {
    device
        .problems
        .iter()
        .map(|p| p.level)
        .min_by_key(|l| rank(*l))
}

fn fix_line(problem: &Problem) -> String {
    match &problem.fixed_version {
        Some(version) => format!("Update to {} to fix this.", plain(version)),
        None => "No fix is known yet. Check the maker's website for news.".to_string(),
    }
}

fn problem_title(problem: &Problem) -> String {
    format!(
        "{}: Security problem in {}",
        level_word(problem.level),
        plain(&problem.product)
    )
}

fn checked_line(devices: &[DeviceBlock]) -> String {
    // The oldest check is the honest one when several devices are listed.
    let oldest = devices.iter().filter_map(|d| d.last_checked).min();
    match oldest {
        Some(time) => {
            let local = time.with_timezone(&Local);
            format!("Last checked: {}.", local.format("%-d %b %Y, %H:%M"))
        }
        None => "Last checked: not recorded.".to_string(),
    }
}

/// Devices worst first, then by name; problems worst first inside each device.
fn sorted(devices: &[DeviceBlock]) -> Vec<DeviceBlock> {
    let mut devices: Vec<DeviceBlock> = devices.to_vec();
    for device in &mut devices {
        device.problems.sort_by_key(|p| rank(p.level));
    }
    devices.sort_by(|a, b| {
        let key = |d: &DeviceBlock| worst(d).map_or(3, rank);
        key(a).cmp(&key(b)).then_with(|| a.name.cmp(&b.name))
    });
    devices
}

// ---------- The four kinds ----------

fn confirm_mail(confirm_url: &str) -> (String, String) {
    let body = format!(
        "Hello,\n\
         \n\
         Someone asked HomeGuard to send email alerts to this address.\n\
         If that was you, open this link and press \"Turn on email alerts\":\n\
         \n\
         {confirm_url}\n\
         \n\
         The link works for 48 hours. Alerts are not on until you do this.\n\
         \n\
         Once they are on, we email you:\n\
         - Right away, when a new Critical problem is found on a device.\n\
         - Once a day, around 7 am, with new Critical and Vulnerable problems.\n\
         \x20\x20Only on days when there is something new.\n\
         \n\
         We won't email you about problems you already have.\n\
         \n\
         If this was not you, ignore this email. Nothing will be sent.\n"
    );
    ("Confirm email alerts from HomeGuard".to_string(), body)
}

fn test_mail(app_url: &str) -> (String, String) {
    let body = format!(
        "Hello,\n\
         \n\
         This is a test email. You asked for it with \"Send a test email\" in\n\
         HomeGuard settings.\n\
         \n\
         If you can read this, HomeGuard can send email to this address.\n\
         \n\
         This test says nothing about your devices. Open My home to see them:\n\
         {app_url}\n"
    );
    ("HomeGuard test email".to_string(), body)
}

fn instant_mail(app_url: &str, devices: &[DeviceBlock]) -> (String, String) {
    let devices = sorted(devices);
    let total: usize = devices.iter().map(|d| d.problems.len()).sum();
    let subject = match devices.as_slice() {
        [one] => format!("{} needs fixing now", plain(&one.name)),
        many => format!("{} devices need fixing now", many.len()),
    };
    let shown = first_problems(&devices, INSTANT_LISTED);
    let mut text = String::from("Hello,\n\n");
    text.push_str(&format!("{subject}.\n\n"));
    match shown.as_slice() {
        [(device, problems)] if problems.len() == 1 => {
            text.push_str(&problem_lines(problems[0], ""));
            text.push_str(&format!(
                "\nSee the details and what to do:\n{}\n",
                device_url(app_url, &device.id)
            ));
        }
        _ => {
            let single_device = devices.len() == 1;
            for (device, problems) in &shown {
                if !single_device {
                    text.push_str(&format!("{}\n", plain(&device.name)));
                }
                let indent = if single_device { "" } else { "  " };
                for problem in problems {
                    text.push_str(&problem_lines(problem, indent));
                }
                text.push_str(&format!("{indent}{}\n\n", device_url(app_url, &device.id)));
            }
            if total > INSTANT_LISTED {
                text.push_str(&format!("and {} more: {app_url}\n", total - INSTANT_LISTED));
            }
        }
    }
    text.push_str(&format!("\n{}\n", checked_line(&devices)));
    (subject, text)
}

/// Title, summary (when there is room for it), exploited line and fix line of one problem.
fn problem_lines(problem: &Problem, indent: &str) -> String {
    let mut text = format!("{indent}{}\n", problem_title(problem));
    let summary = one_line_summary(&problem.summary);
    if !summary.is_empty() {
        text.push_str(&format!("{}\n", wrap(&summary, indent)));
    }
    if problem.exploited {
        text.push_str(&format!(
            "{indent}Attackers are already using this problem.\n"
        ));
    }
    text.push_str(&format!("{}\n", wrap(&fix_line(problem), indent)));
    text
}

/// The first `limit` problems over all devices, worst first, grouped by device again.
fn first_problems(devices: &[DeviceBlock], limit: usize) -> Vec<(&DeviceBlock, Vec<&Problem>)> {
    let mut flat: Vec<(usize, &Problem)> = devices
        .iter()
        .enumerate()
        .flat_map(|(i, d)| d.problems.iter().map(move |p| (i, p)))
        .collect();
    flat.sort_by_key(|(_, p)| rank(p.level));
    flat.truncate(limit);
    let mut grouped: Vec<(&DeviceBlock, Vec<&Problem>)> = Vec::new();
    for (index, problem) in flat {
        let device = &devices[index];
        match grouped.iter_mut().find(|(d, _)| std::ptr::eq(*d, device)) {
            Some((_, list)) => list.push(problem),
            None => grouped.push((device, vec![problem])),
        }
    }
    grouped
}

fn digest_mail(app_url: &str, devices: &[DeviceBlock]) -> (String, String) {
    let devices = sorted(devices);
    let problems: usize = devices.iter().map(|d| d.problems.len()).sum();
    let subject = format!(
        "Daily summary: {problems} new {} on {} {}",
        plural(problems, "problem", "problems"),
        devices.len(),
        plural(devices.len(), "device", "devices")
    );
    let mut text = String::from("Hello,\n\n");
    text.push_str(&wrap(
        &format!(
            "Since the last summary we found {problems} new {} on {} {}. The worst are first.",
            plural(problems, "problem", "problems"),
            devices.len(),
            plural(devices.len(), "device", "devices")
        ),
        "",
    ));
    text.push_str("\n\n");
    for device in devices.iter().take(DIGEST_DEVICES) {
        text.push_str(&digest_device(app_url, device));
    }
    if devices.len() > DIGEST_DEVICES {
        text.push_str(&format!(
            "and {} more devices: {app_url}\n\n",
            devices.len() - DIGEST_DEVICES
        ));
    }
    text.push_str(
        "This summary only lists new problems. Problems you were told about before\n\
         are not repeated. Open My home to see everything that is still open:\n",
    );
    text.push_str(&format!("{app_url}\n\n{}\n", checked_line(&devices)));
    (subject, text)
}

fn digest_device(app_url: &str, device: &DeviceBlock) -> String {
    let level = worst(device).map_or("", level_word);
    let mut text = format!("{}  ({level})\n", plain(&device.name));
    for problem in device.problems.iter().take(DIGEST_PROBLEMS_PER_DEVICE) {
        text.push_str(&format!("  {}\n", problem_title(problem)));
        text.push_str(&format!("{}\n", wrap(&fix_line(problem), "    ")));
    }
    if device.problems.len() > DIGEST_PROBLEMS_PER_DEVICE {
        text.push_str(&format!(
            "  and {} more on this device\n",
            device.problems.len() - DIGEST_PROBLEMS_PER_DEVICE
        ));
    }
    text.push_str(&format!("  {}\n\n", device_url(app_url, &device.id)));
    text
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    use super::*;

    const APP: &str = "https://homeguard.example";
    const UNSUB: &str = "https://homeguard.example/notifications/unsubscribe?token=abc";
    const BANNED: [&str; 4] = ["all clear", "all good", "good news", "up to date"];

    fn problem(level: RiskLevel, fix: Option<&str>, exploited: bool) -> Problem {
        Problem {
            level,
            product: "Acme CamOS".into(),
            summary: "A flaw lets someone on your network take control of the camera. More text."
                .into(),
            fixed_version: fix.map(str::to_string),
            exploited,
        }
    }

    fn device(name: &str, problems: Vec<Problem>) -> DeviceBlock {
        DeviceBlock {
            id: format!("id-{}", name.len()),
            name: name.into(),
            last_checked: Some(Utc.with_ymd_and_hms(2026, 10, 25, 14, 5, 0).unwrap()),
            problems,
        }
    }

    fn input(content: MailContent) -> MailInput {
        MailInput {
            app_url: APP.into(),
            unsubscribe_url: UNSUB.into(),
            content,
        }
    }

    fn instant(devices: Vec<DeviceBlock>) -> BuiltMail {
        build(&input(MailContent::Instant { devices }))
    }

    fn digest(devices: Vec<DeviceBlock>) -> BuiltMail {
        build(&input(MailContent::Digest { devices }))
    }

    fn all_kinds() -> Vec<BuiltMail> {
        let one = || {
            vec![device(
                "Camera",
                vec![problem(RiskLevel::Critical, Some("3.1.2"), true)],
            )]
        };
        vec![
            build(&input(MailContent::Confirm {
                confirm_url: "https://homeguard.example/notifications/confirm?token=x".into(),
            })),
            build(&input(MailContent::Test)),
            instant(one()),
            digest(one()),
        ]
    }

    fn outside_footer(body: &str) -> &str {
        body.split("\n--\n").next().unwrap_or(body)
    }

    #[test]
    fn every_kind_ends_with_the_exact_footer() {
        let expected = "--\nWe only email about new problems. No email does not mean a device is safe.\n\nYou get these emails because you turned on email alerts in HomeGuard.\nStop them: https://homeguard.example/notifications/unsubscribe?token=abc\n";
        for mail in all_kinds() {
            assert!(
                mail.body.ends_with(expected),
                "footer missing in {}",
                mail.subject
            );
        }
    }

    #[test]
    fn no_mail_uses_a_banned_phrase_or_calls_anything_safe_outside_the_footer() {
        for mail in all_kinds() {
            let text = format!("{}\n{}", mail.subject, outside_footer(&mail.body)).to_lowercase();
            for phrase in BANNED {
                assert!(!text.contains(phrase), "{phrase} in {}", mail.subject);
            }
            assert!(!text.contains("safe"), "safe in {}", mail.subject);
        }
    }

    #[test]
    fn the_confirm_mail_has_its_subject_link_and_48_hours() {
        let mail = &all_kinds()[0];
        assert_eq!(mail.subject, "Confirm email alerts from HomeGuard");
        assert!(mail
            .body
            .contains("\nhttps://homeguard.example/notifications/confirm?token=x\n"));
        assert!(mail.body.contains("The link works for 48 hours."));
    }

    #[test]
    fn the_test_mail_says_it_is_a_test_and_links_home() {
        let mail = &all_kinds()[1];
        assert_eq!(mail.subject, "HomeGuard test email");
        assert!(mail.body.contains("This is a test email."));
        assert!(mail.body.contains("\nhttps://homeguard.example\n"));
    }

    #[test]
    fn one_critical_problem_reads_like_the_design_example() {
        let mail = instant(vec![device(
            "Front door camera",
            vec![problem(RiskLevel::Critical, Some("3.1.2"), true)],
        )]);
        assert_eq!(mail.subject, "Front door camera needs fixing now");
        assert!(mail.body.contains(
            "Front door camera needs fixing now.\n\nCritical: Security problem in Acme CamOS\n"
        ));
        assert!(mail
            .body
            .contains("A flaw lets someone on your network take control of the camera.\n"));
        assert!(mail
            .body
            .contains("Attackers are already using this problem.\nUpdate to 3.1.2 to fix this.\n"));
        assert!(mail.body.contains(
            "See the details and what to do:\nhttps://homeguard.example/devices/id-17\n"
        ));
        assert!(mail.body.contains("Last checked: "));
    }

    #[test]
    fn the_summary_is_cut_after_its_first_sentence() {
        let mail = instant(vec![device(
            "Cam",
            vec![problem(RiskLevel::Critical, None, false)],
        )]);
        assert!(!mail.body.contains("More text."));
    }

    #[test]
    fn a_missing_fix_says_so_without_promising_one() {
        let mail = instant(vec![device(
            "Cam",
            vec![problem(RiskLevel::Critical, None, false)],
        )]);
        assert!(mail
            .body
            .contains("No fix is known yet. Check the maker's website for news."));
        assert!(!mail.body.contains("Attackers"));
    }

    #[test]
    fn several_devices_get_one_block_each_and_a_count_in_the_subject() {
        let mail = instant(vec![
            device("Cam", vec![problem(RiskLevel::Critical, Some("1"), false)]),
            device(
                "Router",
                vec![problem(RiskLevel::Critical, Some("2"), false)],
            ),
        ]);
        assert_eq!(mail.subject, "2 devices need fixing now");
        assert!(mail
            .body
            .contains("\nCam\n  Critical: Security problem in Acme CamOS\n"));
        assert!(mail.body.contains("\nRouter\n  Critical: "));
    }

    #[test]
    fn an_instant_mail_lists_five_problems_and_counts_the_rest() {
        let problems = (0..8)
            .map(|_| problem(RiskLevel::Critical, Some("2"), false))
            .collect();
        let mail = instant(vec![device("Cam", problems)]);
        assert_eq!(mail.body.matches("Critical: Security problem").count(), 5);
        assert!(mail
            .body
            .contains("and 3 more: https://homeguard.example\n"));
    }

    #[test]
    fn a_subject_loses_line_breaks_and_stays_short() {
        let mail = instant(vec![device(
            "Cam\r\nBcc: x@example.com",
            vec![problem(RiskLevel::Critical, None, false)],
        )]);
        assert_eq!(mail.subject, "Cam Bcc: x@example.com needs fixing now");
        assert!(!mail.subject.contains(['\r', '\n']));
        let long = "x".repeat(300);
        assert!(clean_subject(&long).chars().count() <= 120);
    }

    #[test]
    fn a_device_name_with_line_breaks_stays_on_one_body_line() {
        let mail = digest(vec![device(
            "Cam\r\nBcc: x",
            vec![problem(RiskLevel::Vulnerable, Some("2"), false)],
        )]);
        assert!(mail.body.contains("\nCam Bcc: x  (Vulnerable)\n"));
        assert!(!mail.body.contains('\r'));
    }

    #[test]
    fn the_digest_subject_counts_problems_and_devices_with_plurals() {
        let two_on_one = digest(vec![device(
            "Cam",
            vec![
                problem(RiskLevel::Critical, None, false),
                problem(RiskLevel::Vulnerable, None, false),
            ],
        )]);
        assert_eq!(
            two_on_one.subject,
            "Daily summary: 2 new problems on 1 device"
        );
        let single = digest(vec![device(
            "Cam",
            vec![problem(RiskLevel::Vulnerable, None, false)],
        )]);
        assert_eq!(single.subject, "Daily summary: 1 new problem on 1 device");
    }

    #[test]
    fn the_digest_puts_the_worst_device_first_with_its_level_word() {
        let mail = digest(vec![
            device(
                "Aaa",
                vec![problem(RiskLevel::Vulnerable, Some("2"), false)],
            ),
            device("Zzz", vec![problem(RiskLevel::Critical, Some("2"), false)]),
        ]);
        let critical = mail.body.find("Zzz  (Critical)").unwrap();
        let vulnerable = mail.body.find("Aaa  (Vulnerable)").unwrap();
        assert!(critical < vulnerable);
        assert!(mail.body.contains("Problems you were told about before"));
        assert!(mail.body.contains("Last checked: "));
    }

    #[test]
    fn the_digest_lists_twenty_devices_and_counts_the_rest() {
        let devices = (0..23)
            .map(|i| {
                device(
                    &format!("Device {i:02}"),
                    vec![problem(RiskLevel::Vulnerable, Some("2"), false)],
                )
            })
            .collect();
        let mail = digest(devices);
        assert_eq!(mail.body.matches("Security problem in").count(), 20);
        assert!(mail
            .body
            .contains("and 3 more devices: https://homeguard.example\n"));
        assert_eq!(mail.subject, "Daily summary: 23 new problems on 23 devices");
    }

    #[test]
    fn the_digest_lists_five_problems_per_device() {
        let problems = (0..7)
            .map(|_| problem(RiskLevel::Vulnerable, Some("2"), false))
            .collect();
        let mail = digest(vec![device("Cam", problems)]);
        assert_eq!(mail.body.matches("Security problem in").count(), 5);
        assert!(mail.body.contains("  and 2 more on this device\n"));
    }

    #[test]
    fn mails_with_findings_always_name_the_level_as_a_word() {
        let critical = instant(vec![device(
            "Cam",
            vec![problem(RiskLevel::Critical, None, false)],
        )]);
        let vulnerable = digest(vec![device(
            "Cam",
            vec![problem(RiskLevel::Vulnerable, None, false)],
        )]);
        assert!(critical.body.contains("Critical:"));
        assert!(vulnerable.body.contains("Vulnerable:"));
    }

    #[test]
    fn free_text_is_wrapped_but_links_are_not() {
        let mut long = problem(RiskLevel::Critical, None, false);
        long.summary = "word ".repeat(60);
        let mail = instant(vec![device("Cam", vec![long])]);
        for line in outside_footer(&mail.body)
            .lines()
            .filter(|l| !l.starts_with("http"))
        {
            assert!(line.chars().count() <= 80, "too long: {line}");
        }
    }

    #[test]
    fn plain_removes_control_characters() {
        assert_eq!(plain("a\u{0}b\tc\nd"), "a b c d");
    }
}
