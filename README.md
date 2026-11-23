# MeatnDoor Image Studio

[Open the uploader](https://nars77.github.io/meatndoor-image-host/).

## Upload an image

Choose **Upload via GitHub**, sign in with repository write access, choose your image and commit directly to the `media` branch. Return to Image Studio and choose **Copy link** beside the file. The library refreshes when you return. Use **Refresh** if the commit is still processing.

For drag-and-drop uploads, select **Connect uploads** and supply a fine-grained GitHub token restricted to this repository with **Contents: Read and write**. The page keeps it in memory until you disconnect, reload or close the tab. Direct uploads support JPEG, PNG, WebP, GIF and AVIF up to 10 MiB each. Each upload receives a unique path. Links are public raw image URLs that work without signing in.

## Storage and deployment

The static site is served from `main:/docs`. Images live under `media:images/` and can be managed in GitHub. Keep the repository public and the image at its original path to preserve its link. Replacing a file through GitHub changes what its branch-based link serves after GitHub's cache refreshes.

GitHub storage and API rate limits apply. This setup is intended for a modest asset library. For a large catalog or high-volume app traffic, use object storage with a CDN.

For a local preview, run `python3 -m http.server 8080 --directory docs` and open `http://localhost:8080`. The upload destination is the live repository.
