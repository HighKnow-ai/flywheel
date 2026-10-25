/**
 * Load every face the stylesheet declares, now, and wait for them.
 *
 * `document.fonts.ready` alone is not enough: it settles once the faces *already requested* have loaded, and a
 * face is only requested when text first needs it. A screen that draws its first Story key after `ready`
 * settled starts JetBrains Mono loading then, and when it lands every key is re-laid out a pixel or two wider
 * or taller. A browser test measuring the screen meanwhile (the flicker recorder, the layout-defect check)
 * sees that swap as a shift that has nothing to do with the code under test: the flake #208 hit in
 * `no-flicker.browser.test.tsx`. Loading every declared face up front takes the swap out of every test.
 */
export async function loadEveryFont(): Promise<void> {
  await Promise.all(
    Array.from(document.fonts, (face) => (face.status === "loaded" ? undefined : face.load().catch(() => undefined))),
  );
  await document.fonts.ready;
}
