"use client";

import { useEffect, useRef } from "react";
import { signOut } from "next-auth/react";

const LAST_ACTIVITY_KEY =
  "giftij-admin-last-activity";

const INACTIVITY_MS = 3 * 60 * 1000;

export function AdminInactivityGuard() {
  const signingOutRef = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null =
      null;

    function clearTimer() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }

    function getLastActivity() {
      const raw =
        window.localStorage.getItem(
          LAST_ACTIVITY_KEY,
        );

      if (!raw) {
        return Date.now();
      }

      const parsed = Number(raw);

      return Number.isFinite(parsed)
        ? parsed
        : Date.now();
    }

    async function expireSession() {
      if (signingOutRef.current) return;

      signingOutRef.current = true;
      clearTimer();

      window.localStorage.removeItem(
        LAST_ACTIVITY_KEY,
      );

      await signOut({
        callbackUrl: "/login",
      });
    }

    function scheduleExpiry() {
      clearTimer();

      const elapsed =
        Date.now() - getLastActivity();

      const remaining =
        INACTIVITY_MS - elapsed;

      if (remaining <= 0) {
        void expireSession();
        return;
      }

      timer = setTimeout(() => {
        void expireSession();
      }, remaining);
    }

    function recordActivity() {
      if (signingOutRef.current) return;

      window.localStorage.setItem(
        LAST_ACTIVITY_KEY,
        String(Date.now()),
      );

      scheduleExpiry();
    }

    function checkWhenReturning() {
      if (signingOutRef.current) return;

      const elapsed =
        Date.now() - getLastActivity();

      if (elapsed >= INACTIVITY_MS) {
        void expireSession();
        return;
      }

      scheduleExpiry();
    }

    const previousActivity =
      window.localStorage.getItem(
        LAST_ACTIVITY_KEY,
      );

    if (previousActivity) {
      const elapsed =
        Date.now() -
        Number(previousActivity);

      if (
        Number.isFinite(elapsed) &&
        elapsed >= INACTIVITY_MS
      ) {
        void expireSession();

        return;
      }
    }

    recordActivity();

    window.addEventListener(
      "pointerdown",
      recordActivity,
    );

    window.addEventListener(
      "keydown",
      recordActivity,
    );

    window.addEventListener(
      "scroll",
      recordActivity,
      { passive: true },
    );

    window.addEventListener(
      "touchstart",
      recordActivity,
      { passive: true },
    );

    window.addEventListener(
      "focus",
      checkWhenReturning,
    );

    document.addEventListener(
      "visibilitychange",
      checkWhenReturning,
    );

    return () => {
      clearTimer();

      window.removeEventListener(
        "pointerdown",
        recordActivity,
      );

      window.removeEventListener(
        "keydown",
        recordActivity,
      );

      window.removeEventListener(
        "scroll",
        recordActivity,
      );

      window.removeEventListener(
        "touchstart",
        recordActivity,
      );

      window.removeEventListener(
        "focus",
        checkWhenReturning,
      );

      document.removeEventListener(
        "visibilitychange",
        checkWhenReturning,
      );
    };
  }, []);

  return null;
}