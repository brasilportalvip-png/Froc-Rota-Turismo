# Froc Rota Turismo — Firestore Security Specification (Phase 0)

## 1. Data Invariants
1. **Identity Isolation**: A user can never read or write another user's `private`, `tourist_documents`, `flight_alerts`, `notifications`, or `conversations` unless verified as an authorized administrator.
2. **No Self-Privilege Escalation**: Users cannot assign or escalate `role` to `admin` or `subadmin` on `/users/{userId}` creation or update; admin privileges live strictly under `/admins/{uid}` or verified admin email (`brasilportalvip@gmail.com` with `email_verified == true`).
3. **Immutable Ownership & Timestamps**: Owner UIDs (`userId`, `ownerUid`, `senderUid`) and `createdAt` timestamps cannot be altered after creation; `createdAt` / `updatedAt` must equal `request.time`.
4. **Master Gate on Subcollections**: Messages inside `/conversations/{conversationId}/messages/{messageId}` must validate parent conversation ownership via `get()` before granting read or write access.
5. **Bounded Payloads & IDs**: All document IDs match `^[a-zA-Z0-9_-]+$` (`<= 128` chars) and every string field has strict `.size()` bounds.

## 2. "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Role Self-Escalation**: Creating `/users/{uid}` with `role: "admin"` as a regular user.
2. **Unverified Email Admin Spoof**: Calling admin read with `email: "brasilportalvip@gmail.com"` when `email_verified: false`.
3. **Shadow Ghost Field Injection**: Creating `/tourist_documents/{id}` with extra field `verifiedByAdmin: true`.
4. **Cross-Tenant PII Read**: Reading `/users/{otherUid}/private/info` while signed in as `{uid}`.
5. **Blanket List Scrape**: Listing `/notifications` without scoping `where('userId', '==', auth.uid)`.
6. **Conversation Hijack**: Posting a message to `/conversations/{otherConvId}/messages/{msgId}` owned by another user.
7. **Sender Spoofing**: Posting a message inside own conversation with `senderUid` set to another UID or `senderRole: "admin"`.
8. **ID Poisoning**: Writing to `/flight_alerts/{1500_char_garbage_id}` with invalid characters (`../`).
9. **Client Timestamp Tampering**: Creating a document with `createdAt` backdated instead of `request.time`.
10. **Terminal State Mutation**: Modifying a `resolved` conversation or mutating `ownerUid` on update.
11. **Non-Admin Editorial Hijack**: Regular user attempting to publish/create a document in `/posts/{postId}` or `/agents/{agentId}`.
12. **Campaign Metrics Tampering**: Advertiser forging `conversions: 9999` on `/campaigns/{id}` update outside allowed editorial fields.
