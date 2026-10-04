# LifeMind Fonts

## Noto Serif SC

`noto-serif-sc-variable.woff2` is the full variable family, with a `wght`
axis from 200 to 900. It contains 30,928 mapped characters for offline
Simplified Chinese content.

The source is Google's official font repository:
https://github.com/google/fonts/tree/main/ofl/notoserifsc

The unmodified source was converted from TrueType to WOFF2 with FontTools.
The SIL Open Font License permits embedding and redistribution; retain
`NotoSerifSC-OFL.txt` alongside the font.

```css
@font-face {
  font-family: "Noto Serif SC";
  src: url("/fonts/noto-serif-sc-variable.woff2") format("woff2");
  font-style: normal;
  font-weight: 200 900;
  font-display: swap;
}
```

## Maghfirea

The requested reference site declares `Maghfirea` in its official HTML:
https://persepolis.getty.edu/

Its font name table identifies:

- Family: Maghfirea
- Full name: Maghfirea Regular
- PostScript name: MaghfireaRegular
- Copyright: Copyright 2020, Salsabiyl Studios
- Designer: Royhan Salsabiyl
- Vendor URL: Creative Market
- Designer URL: https://www.behance.net/royhansalsabiyl

The font's metadata contains no embedding or redistribution license. The
author's public Behance page identifies a download link at Creative Fabrica,
where the product page says the font is subscription-only and that downloads
include a commercial license. A public web-font URL does not establish
permission to bundle that file. No copy of the reference font is distributed
by LifeMind.

Author reference: https://www.behance.net/gallery/117400525/Maghfirea-Typeface
Licensed source: https://www.creativefabrica.com/product/maghfirea/ref/532313/

The macOS user and system font directories were checked on 2026-10-04.
Maghfirea was not present. The application's local-font lookup therefore
uses its declared fallback until a licensed file is provided.

For the exact font, obtain an appropriate web and desktop application
embedding license from the designer or vendor. Place the licensed WOFF2
file at `public/fonts/maghfirea-regular.woff2`, retain its license here,
and add its URL to the existing `Maghfirea` font-face source:

```css
src: local("Maghfirea Regular"), local("Maghfirea"),
  url("/fonts/maghfirea-regular.woff2") format("woff2");
```

Add the URL only after the file and relevant license are present.
