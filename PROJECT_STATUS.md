# PROJECT_STATUS.md

## Recovered snapshot
Recovered from dev-dist.zip. The archive includes full source code and Git history, not only built dist files. Git branch: main. Remote: https://github.com/sonphu-app/order-app.git

## Existing functionality observed
- Authentication/current-user helper and login screen.
- Home order dashboard with search and time filters.
- Order pinning and status updates.
- Tracks who marked Done, Delivered and Completed.
- Create order with images and order edit history references.
- Order detail with order chat and image storage.
- Group chat with images.
- Seen/unread tracking for order and group messages.
- Supabase Realtime listeners.
- User/account and permission-related code.
- Weekly system task for electronic-scale inspection.
- PWA manifest/service worker.
- Web Push infrastructure through Supabase Edge Function.

## Data objects referenced in code
users; orders; order_messages; order_message_images; order_images; order_edit_history; group_messages; group_message_images; push_subscriptions; Storage bucket order-images.

## Important observations
1. package.json requests Node 24.x and Vite 8 beta.
2. The uploaded node_modules was created for a different OS. A Linux build test stopped because the native Rolldown binding was missing. This is an environment/dependency issue, not a proven source-code failure. Delete node_modules and run npm install on the target machine before testing.
3. systemTasks.js expects orders.system_key and orders.kind. Confirm those columns exist in the Supabase schema.
4. Current code mixes snake_case DB fields and camelCase UI-normalized fields. Preserve normalization unless intentionally refactoring the whole data layer.
5. Supabase URL and publishable/anon key are present client-side, which is normal for Supabase public client credentials; security still depends on correct RLS policies. Never place service-role keys in frontend code.

## Recommended first Codex task
Read AGENTS.md and PROJECT_STATUS.md, then inspect the entire current codebase without modifying anything. Produce a map of routes, components, Supabase tables/fields, realtime channels, storage, push flow and known risks. Then propose the smallest next change requested by the user.
