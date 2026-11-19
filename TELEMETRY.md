# Privacy and upstream communication

This fork does not send product telemetry, analytics, feedback, crash reports, waitlist signups, or integration/language requests to the original Cabinet maintainers.

The upstream reporting clients, event senders, ingestion routes, PostHog integration, GitHub-star requests, native automatic updater, community prompts, and promotional links have been removed.

Release checks and template browsing make no remote requests by default. Operators may configure independent services with:

- `CABINET_RELEASE_MANIFEST_URL`: a direct release-manifest URL.
- `CABINET_REGISTRY_REPOSITORY`: an independent GitHub `owner/repository`.

Original Cabinet service hosts and GitHub repositories are rejected. Maintenance requests do not follow redirects, and release manifests pointing back to the original project are rejected.

Local diagnostic logs and manually downloaded diagnostic bundles remain available on this machine. Existing telemetry queues from older versions are not uploaded; the legacy CLI uninstall cleanup can still remove those files when explicitly requested.

User-configured AI providers, OAuth services, MCP integrations, Git repositories, and external content retain their normal network behavior. This is removal of upstream product communication, not an offline mode for those user-selected services.
