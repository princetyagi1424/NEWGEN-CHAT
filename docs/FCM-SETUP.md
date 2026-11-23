# Firebase Cloud Messaging setup

## Android project

1. Create or select a Firebase project in the Firebase Console.
2. Register Android app package `com.newgenchat.app`.
3. Download `google-services.json` and place it at `app/google-services.json` (it is intentionally git-ignored).
4. Enable Firebase Cloud Messaging for the project.
5. Build with Gradle. The Google Services plugin is conditionally applied only when this file exists; the Firebase Messaging dependency is included through Firebase BoM `35.2.0`.
6. Install on a physical Android device with Google Play services. Grant Android 13+ notification permission.

## Backend

1. In Firebase Console / Google Cloud IAM, create a service account dedicated to sending FCM messages. Grant only the Firebase Cloud Messaging API send permission required by your project.
2. Keep its JSON key outside the repository. Base64-encode the JSON and set `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` in the server's secret manager.
3. Restart the API. If the variable is absent, FCM is intentionally disabled and normal chat APIs continue working.
4. Register/login from the app. The client obtains its current FCM registration token and registers it over the authenticated HTTPS API.

## Privacy model

The API sends a data-only message containing `kind=new_message` and a random event ID. It does not include message body, sender name, conversation/group ID, ciphertext, attachment name, or media URL. The Android app displays only “You have a new message”. FCM tokens are not returned by API endpoints and are removed when Firebase reports them as invalid. The app syncs a rotated token on its next successful login.

## Validation

- Verify a device token appears in the server database without logging it.
- Send a direct message and a group message while recipient app is backgrounded.
- Confirm the lock-screen notification is generic and contains no sender/chat details.
- Revoke notification permission and confirm the app does not crash.
- Rotate/uninstall/reinstall the app and verify the new token is registered on next login.
- Test with Firebase credentials absent: message send must still succeed, with push skipped.

FCM setup is not considered live until the owner supplies the Firebase project configuration and service-account secret and the above device tests pass.
