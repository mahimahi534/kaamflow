# Superseded Supabase verification report

The current connection, migration, and test status is maintained in
[KAAMFLOW_SUPABASE_VERIFICATION_REPORT.md](./KAAMFLOW_SUPABASE_VERIFICATION_REPORT.md).

Historical probe results are retained there with their limitations: Auth
health previously returned HTTP 200, while REST returned HTTP 401. No database
migration was applied, and no production data or accounts were changed. The
cause of the REST 401 remains unknown until a separate disposable project's
URL/key and Data API settings can be checked.
