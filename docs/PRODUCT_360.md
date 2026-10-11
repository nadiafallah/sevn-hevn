# 360° views of pieces

A piece can show an interactive 360° view. Customers can:

- turn it by dragging with a mouse or a finger;
- zoom in, go back to the first view, and open it full screen;
- see inside it, when real interior photos or an opening animation exist.

Customers open it from the **360° View** button on the product card, or from the **360°** thumbnail in the piece's gallery. The viewer, its wording and its errors work in English, Arabic (right to left), Russian and French.

## What can be shown (only real material)

| Kind | What you provide | What the customer can do |
| --- | --- | --- |
| **Photo spin** | 12–72 photographs taken in one horizontal turn around the piece (24 or 36 recommended), all the same size and orientation | Turn left and right. Zoom into the larger photograph of the same angle. |
| **3D model** | One `.glb` file (glTF 2.0) of the real piece, up to 25 MB, with textures inside the file and no Draco or Meshopt compression | Turn to any angle and zoom. Open the piece, if the file contains an opening animation. |
| **Inside** | Real photographs of the interior, added to either kind | “View inside” switches to those photographs. |

Rules the system follows:

- A flat photo is never turned into a fake spin.
- Unseen sides, interiors and opening mechanisms are never invented.
- The “View inside” button appears only when interior photos or an opening animation exist.

## Adding a view to a piece (panel)

1. In `/admin/products/<ref>`, give the piece at least one normal photo first. It is used as the model's loading image.
2. In the **360° view** section:
   - **Add spin frames.** Select all the photographs at once. They are sorted by file name (IMG_0001 … IMG_0036), cleaned of camera and location data, and stored in two sizes. A frame of another shape is refused.
   - **Add inside photos** (optional).
   - **Upload 3D model (.glb)** (optional). The file goes straight to Storage and is then checked. A broken, compressed or multi-file model is refused with the reason, and deleted.
3. Check the **Preview**. It is exactly what customers will see.
4. If needed, adjust the settings:
   - Fix the order with ← / → or **Reverse the order**.
   - Choose the first frame shown.
   - Choose the opening animation, if the model has one.
5. Tick **Show the 360° view on the website** and save. Switching on is refused until the view is complete.
6. The piece must be published. The website updates by itself, with no code change.

Removing frames, so that fewer than 12 remain, or removing the model switches an incomplete view off again. Customers never see a broken button.

## Photographing a spin

- Use a turntable and a tripod. Keep the camera height, distance, zoom and lighting the same for every shot, against a plain, even background.
- Turn the piece the same amount each time: 15° for 24 photos, or 10° for 36.
- Do not crop, rotate or resize individual photos. Every frame must be the same size.
- **Colours:** each listing is one piece in one colour. Photograph each colour as its own listing, so the viewer never shows another colour.

## Where things are stored

- **Settings:** the `product_views` table.
- **Frames and interior photos:** the `product_view_media` table.
- **Files:** the public `product-media` Storage bucket, under `<ref>/360/`.
- **Database migration:** `supabase/migrations/20261012120000_product_360.sql`. The rollback is in `supabase/rollbacks/`.
- **Access:** visitors read the views of published pieces only. Only the owner can change them, and every change is logged.
- **Updates:** changes refresh the website's catalogue automatically.

## Limits and costs (free plans)

- **Supabase Free:** 1 GB of storage and 5 GB of traffic a month. A 36-frame spin is about 2–4 MB, and a model is usually 1–10 MB.
  - The viewer downloads files only when a customer opens it. Product cards load just the normal photo.
  - If traffic grows past the free plan, Supabase Pro costs US$25 a month. Nothing is charged automatically.
- **Vercel:** spin frames and models are served directly from Storage, so they don't use Vercel's image transformations.
