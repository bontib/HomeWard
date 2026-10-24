//! A sliding-window rate limiter for the NVD API: at most `max` calls in any `window`.
//! It waits instead of failing, so callers just `acquire().await` before each request.

use std::collections::VecDeque;
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use tokio::time::Instant;

pub struct RateLimiter {
    max: usize,
    window: Duration,
    sent: Mutex<VecDeque<Instant>>,
}

impl RateLimiter {
    pub fn new(max: usize, window: Duration) -> Self {
        Self {
            max: max.max(1),
            window,
            sent: Mutex::new(VecDeque::new()),
        }
    }

    pub async fn acquire(&self) {
        loop {
            match self.try_take() {
                None => return,
                Some(wait) => tokio::time::sleep(wait).await,
            }
        }
    }

    /// Takes a slot and returns `None`, or returns how long to wait for the next free slot.
    fn try_take(&self) -> Option<Duration> {
        let now = Instant::now();
        let mut sent = self.sent.lock().unwrap_or_else(PoisonError::into_inner);
        while sent
            .front()
            .is_some_and(|t| now.duration_since(*t) >= self.window)
        {
            sent.pop_front();
        }
        if sent.len() < self.max {
            sent.push_back(now);
            return None;
        }
        let oldest = sent.front().copied().unwrap_or(now);
        Some((oldest + self.window).saturating_duration_since(now))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const WINDOW: Duration = Duration::from_secs(30);

    #[tokio::test(start_paused = true)]
    async fn calls_within_the_limit_do_not_wait() {
        let limiter = RateLimiter::new(5, WINDOW);
        let start = Instant::now();
        for _ in 0..5 {
            limiter.acquire().await;
        }
        assert_eq!(start.elapsed(), Duration::ZERO);
    }

    #[tokio::test(start_paused = true)]
    async fn the_sixth_call_waits_for_the_window_to_pass() {
        let limiter = RateLimiter::new(5, WINDOW);
        let start = Instant::now();
        for _ in 0..6 {
            limiter.acquire().await;
        }
        assert_eq!(start.elapsed(), WINDOW);
    }

    #[tokio::test(start_paused = true)]
    async fn a_higher_limit_lets_more_calls_through() {
        let limiter = RateLimiter::new(50, WINDOW);
        let start = Instant::now();
        for _ in 0..50 {
            limiter.acquire().await;
        }
        assert_eq!(start.elapsed(), Duration::ZERO);
    }

    #[tokio::test(start_paused = true)]
    async fn slots_free_up_one_by_one() {
        let limiter = RateLimiter::new(2, WINDOW);
        let start = Instant::now();
        limiter.acquire().await;
        tokio::time::sleep(Duration::from_secs(10)).await;
        limiter.acquire().await;
        limiter.acquire().await; // waits until the first call is 30 s old
        assert_eq!(start.elapsed(), WINDOW);
        limiter.acquire().await; // waits until the second call is 30 s old
        assert_eq!(start.elapsed(), Duration::from_secs(40));
    }

    #[tokio::test(start_paused = true)]
    async fn twelve_calls_at_five_per_window_take_two_windows() {
        let limiter = RateLimiter::new(5, WINDOW);
        let start = Instant::now();
        for _ in 0..12 {
            limiter.acquire().await;
        }
        assert_eq!(start.elapsed(), WINDOW * 2);
    }
}
