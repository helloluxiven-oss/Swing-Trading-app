import { getWatchlist } from "@/lib/data";
import { adoptStarterFavourites } from "../actions";
import FavManager from "@/components/FavManager";

export const dynamic = "force-dynamic";

export default async function FavouritesPage() {
  let favs = await getWatchlist();
  // First visit with no favourites: make the starter list (XAU, BTC, NVDA) real, so it can be edited.
  if (!favs.length) {
    await adoptStarterFavourites();
    favs = await getWatchlist();
  }
  return (
    <>
      <section className="hero-today">
        <h1 style={{ margin: 0 }}>⭐ Favourites</h1>
        <p className="sub" style={{ margin: "4px 0 0" }}>Add or remove anything you follow and put it in order. The first three are your dashboard charts; alerts watch all of them.</p>
      </section>
      <div style={{ marginTop: 12 }}>
        <FavManager favs={favs.map((f) => ({ symbol: f.symbol, market: f.market, name: f.name ?? null }))} />
      </div>
    </>
  );
}
