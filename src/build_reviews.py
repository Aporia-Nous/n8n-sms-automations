#!/usr/bin/env python3
"""Builds ../review-requests.json"""
from wflib import WF
w = WF('reviews')
w.webhook("Job Completed Webhook", "job-completed", [0, 0], "POST a finished job/visit here (POS, CRM, calendar 'appointment completed', Votel webhook step).")
w.code("Queue Review Request", "rv_queue.js", [240, 0], "Dedupe per job, 90-day limit per customer, opt-outs, incentive check. Writes data/review-queue.json")
w.link("Job Completed Webhook", "Queue Review Request"); w.link("Queue Review Request", "Test mode?")
w.schedule("Every 15 Minutes", 15, [0, 260], "Real-time scan for due review texts")
w.webhook("Run Scan Now (test)", "reviews-run", [0, 420], "Test hook: POST {\"now\":\"ISO time\"} to scan at a simulated time (only honored in test mode).", all_entries=True)
w.code("Find Due Requests + Follow-ups", "rv_scan.js", [260, 340], "Business hours + quiet hours, once-only")
w.link("Every 15 Minutes", "Find Due Requests + Follow-ups"); w.link("Run Scan Now (test)", "Find Due Requests + Follow-ups")
w.webhook("Review Reply Webhook", "review-reply", [0, 700], "Inbound SMS for the review number")
w.code("Normalize Inbound SMS", "normalize_sms.js", [240, 700])
w.code("Handle Review Reply", "rv_reply.js", [480, 700], "Same link for everyone; unhappy -> private owner alert")
w.link("Review Reply Webhook", "Normalize Inbound SMS"); w.link("Normalize Inbound SMS", "Handle Review Reply")
w.delivery_tail(760, 460)
w.link("Find Due Requests + Follow-ups", "Test mode?"); w.link("Handle Review Reply", "Test mode?")
w.sticky("## Review Requests (template)\nTest mode is ON by default. Nothing is sent: would-be texts go to data/logs/outbox.jsonl.\n\nGoogle policy built in: no incentives (templates with incentive words are refused), no gating (every customer gets the same link, in the first text and in both happy/unhappy auto-replies). Unhappy replies also alert the owner privately.\n\n1 request ~2h after the job (inside business hours, outside quiet hours), max 1 per customer per 90 days, 1 follow-up after 3 days if no reply.", [-40, -400], h=300)
w.save("ReviewRequests01", "Review Requests (template)", "review-requests.json")
