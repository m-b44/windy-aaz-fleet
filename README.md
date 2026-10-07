# AAZ Fleet - browser-only setup

No Node.js or admin access is required on the work PC.

## One-time setup

1. Create a GitHub repository and upload these files.
2. In Windy, create a **Windy Plugins API** key at https://api.windy.com/keys
3. In GitHub: **Settings > Secrets and variables > Actions > New repository secret**
   - Name: `WINDY_API_KEY`
   - Value: your Windy key
4. In GitHub: **Actions > Publish Windy plugin > Run workflow**
5. Open the completed workflow. The final **Publish to Windy** step prints the Windy installation URL.
6. Open that URL in the browser to install the private plugin.

After that, open **AAZ Fleet** inside Windy. Add a King Air registration and the plugin requests its live ADS-B position from adsb.lol.

## Updating later

Upload the changed files, increase the version in `src/pluginConfig.ts` and `package.json`, then run the GitHub Action again.

The plugin is configured as private (`private: true`).
