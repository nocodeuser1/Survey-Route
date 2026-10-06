# SPCC connections

Reviewed: 2026-10-06. Available when the account's SPCC connection service is enabled.

1. Select the source account in Survey Route. In **Settings → SPCC connections**, enter a connection name.
2. Account and agency administrators can authorize **read-only SPCC access** and choose **Create read-only key**. The key is shown once, expires after 90 days, and covers only this account.
3. Use **Copy key** and enter it only in **myScribe → Settings → Survey Route → Read-only API key**. Never put it in chat, voice, a URL or a document.
4. In myScribe, select an existing destination project, approve encrypted key storage, then choose **Connect and save key**. This checks access but does not import.
5. Use **Preview refresh**, review the source account, destination and counts, then **Import previewed records**.

The export includes all account facilities (including sold/inactive records), per-berm plans, source workflow labels, separate recorded dates and authenticated application links. Facilities without a per-berm plan use a facility fallback record. It never modifies a facility, plan or source document.

A recorded PE date is reported as **date recorded**. Without a date, PE status is **Unknown**, even if the workflow says PE stamped or a PDF exists. No engineering certification is inferred. Creation, edit, inspection and recertification dates are not interchangeable with PE dates.

**Revoke key** stops future reads. Removing the creator's administrator access also disables reads. Previously imported data remains in myScribe until **Disconnect**, which removes the stored credential and local snapshots. myScribe's **Undo last import** restores the previous snapshot. Neither action changes Survey Route.

Imported plan links require a Survey Route sign-in and current record permissions. This integration does not export the existing public download URLs or change storage permissions.
