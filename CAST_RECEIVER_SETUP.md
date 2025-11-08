# Custom Cast Receiver Setup - "Stylus One" Branding

To change "Default Media Receiver" to "Stylus One", you need to register a custom Cast receiver application with Google.

## Steps to Register Custom Receiver

### 1. Create Google Cast Developer Account
- Go to https://cast.google.com/publish/
- Sign in with your Google account
- Accept the terms and pay the one-time $5 registration fee (if not already registered)

### 2. Add New Application
- Click "Add New Application"
- Select "Custom Receiver"
- Fill in the details:
  - **Name:** Stylus One
  - **Category:** Video & Audio
  - **Receiver Application URL:** `https://stylus.services/cast-receiver.html`
  - Make sure the URL is publicly accessible via HTTPS

### 3. Configure Application
- **Supported Media:** Check "HLS"
- Leave other settings as default
- Click "Save"

### 4. Get Your Application ID
- After saving, you'll get an **Application ID** (looks like: `12345678`)
- Copy this ID

### 5. Update the Code
Open `/Users/tommyshorez/Projects/HomelabDashboard/client/src/pages/live-tv-page.tsx`

Find this line (around line 1053):
```typescript
receiverApplicationId: (window as any).chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
```

Replace it with your custom app ID:
```typescript
receiverApplicationId: 'YOUR_APP_ID_HERE',  // e.g., '12345678'
```

### 6. Rebuild and Deploy
```bash
npm run build
# Deploy to your server
```

### 7. Test
- Clear your browser cache
- Refresh the Live TV page
- Cast to your Chromecast
- It should now show "Stylus One" instead of "Default Media Receiver"

## Custom Receiver Features

The custom receiver at `/cast-receiver.html` includes:
- ✅ Stylus One branding with custom splash screen
- ✅ Loading indicator
- ✅ Optimized HLS streaming configuration
- ✅ Enhanced error handling
- ✅ Better logging for debugging

## Troubleshooting

**If it still shows "Default Media Receiver":**
1. Make sure you saved the app ID in Google Cast Console
2. Clear browser cache completely
3. Restart your Chromecast device
4. Wait a few minutes for Google's servers to propagate the changes

**If casting fails:**
1. Check that `https://stylus.services/cast-receiver.html` is accessible
2. Check browser console for errors
3. Verify the app ID is correct

## Environment Variables

Optionally, you can store the app ID in your `.env` file:
```bash
VITE_CAST_RECEIVER_APP_ID=12345678
```

Then update the code to use:
```typescript
receiverApplicationId: import.meta.env.VITE_CAST_RECEIVER_APP_ID || (window as any).chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
```
