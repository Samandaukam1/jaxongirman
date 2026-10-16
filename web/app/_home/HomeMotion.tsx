"use client";

import { useEffect } from "react";

/**
 * The parts of the landing page's motion that need a pointer or a clock.
 *
 * Everything else moves in CSS. This adds four things, all of them extras —
 * the page reads the same without them:
 *   * blocks below the fold rise in as they are scrolled to;
 *   * the hero stage leans a few degrees toward the pointer;
 *   * each feature card carries a soft light where the pointer is;
 *   * the figures in the stats band count up when they come into view.
 * None of it runs when the system asks for reduced motion.
 */
export function HomeMotion() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const cleanups: (() => void)[] = [];

    const stage = document.querySelector<HTMLElement>(".lp-stage");
    if (stage && window.matchMedia("(pointer: fine)").matches) {
      let frame = 0;
      const lean = (event: PointerEvent) => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const x = event.clientX / window.innerWidth - 0.5;
          const y = event.clientY / window.innerHeight - 0.5;
          stage.style.setProperty("--ry", `${(x * 7).toFixed(2)}deg`);
          stage.style.setProperty("--rx", `${(-y * 5).toFixed(2)}deg`);
        });
      };
      window.addEventListener("pointermove", lean, { passive: true });
      cleanups.push(() => { window.removeEventListener("pointermove", lean); cancelAnimationFrame(frame); });
    }

    const cards = Array.from(document.querySelectorAll<HTMLElement>(".lp-card, .lp-style"));
    for (const card of cards) {
      const light = (event: PointerEvent) => {
        const box = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${event.clientX - box.left}px`);
        card.style.setProperty("--my", `${event.clientY - box.top}px`);
      };
      card.addEventListener("pointermove", light, { passive: true });
      cleanups.push(() => card.removeEventListener("pointermove", light));
    }

    // Only what has not been seen yet waits for its entrance; anything already
    // on screen stays exactly as it was painted.
    const pending = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"))
      .filter((element) => element.getBoundingClientRect().top > window.innerHeight * 0.92);
    const reveal = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        reveal.unobserve(entry.target);
        const element = entry.target as HTMLElement;
        const siblings = element.parentElement ? Array.from(element.parentElement.children) : [];
        element.style.animationDelay = `${(Math.max(0, siblings.indexOf(element)) % 3) * 90}ms`;
        element.classList.remove("lp-pending");
        element.classList.add("lp-in");
        // Its own entrance only: animations inside the card bubble up here too.
        const settle = (event: AnimationEvent) => {
          if (event.target !== element) return;
          element.removeEventListener("animationend", settle);
          element.classList.remove("lp-in");
          element.style.animationDelay = "";
        };
        element.addEventListener("animationend", settle);
      }
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    for (const element of pending) {
      element.classList.add("lp-pending");
      reveal.observe(element);
    }
    cleanups.push(() => {
      reveal.disconnect();
      pending.forEach((element) => element.classList.remove("lp-pending", "lp-in"));
    });

    const counters = Array.from(document.querySelectorAll<HTMLElement>("[data-count]"));
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        const element = entry.target as HTMLElement;
        const target = Number(element.dataset.count) || 0;
        const started = performance.now();
        const step = (now: number) => {
          const progress = Math.min(1, (now - started) / 1400);
          const eased = 1 - Math.pow(1 - progress, 4);
          element.textContent = String(Math.round(target * eased));
          if (progress < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }
    }, { threshold: 0.6 });
    counters.forEach((counter) => observer.observe(counter));
    cleanups.push(() => observer.disconnect());

    return () => cleanups.forEach((cleanup) => cleanup());
  }, []);

  return null;
}
