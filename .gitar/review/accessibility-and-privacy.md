# Accessibility and privacy review

- Flag interactive controls that VoiceOver cannot identify or activate. Check accessible names, roles, focus order, and announcements when the active screen or task state changes.
- Flag schedule planning and navigation flows that depend on sight, color, or an unlabeled gesture. Verify that users can cancel voice or camera capture and recover from permission denial or service failure.
- Flag navigation guidance that treats an uncertain camera inference as a confirmed direction or safety signal.
- Flag credentials in client code or build-time public environment variables. Flag raw audio, images, transcripts, precise location, or attendee details in telemetry, logs, URLs, and error responses.
- Check that API timeouts and retries leave the user with an accessible way to continue. Report concrete failures and identify the affected user flow.
