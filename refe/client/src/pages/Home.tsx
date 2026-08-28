/**
 * Dark Listening Desk: a reference-led, dark browse experience with dense
 * four-up shelves, original Pulse branding, and subtle card-first motion.
 */
import { useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  Globe2,
  Heart,
  Home as HomeIcon,
  Menu,
  MoreHorizontal,
  Pause,
  Play,
  Search,
  SkipBack,
  SkipForward,
  Speaker,
  Volume2,
  X,
} from "lucide-react";

const image = {
  jolene: "/manus-storage/pulse-cover-jolene_4720d406.jpg",
  rider: "/manus-storage/pulse-cover-night-rider_904eabf0.jpg",
  rain: "/manus-storage/pulse-cover-rain-sounds_528fad95.jpg",
  studio: "/manus-storage/pulse-cover-studio_6ad3adac.jpg",
  logo: "/manus-storage/pulse-logo_d158ab89.png",
  kendrick:
    "https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=400&q=84",
  drake:
    "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=84",
  weeknd:
    "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=400&q=84",
  wallen:
    "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=400&q=84",
  garden:
    "https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=600&q=85",
  chartGlobal:
    "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=600&q=85",
  chartUsa:
    "https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=600&q=85",
};

type Track = {
  title: string;
  artist: string;
  art: string;
  duration: string;
  subtitle?: string;
};

const trending: Track[] = [
  { title: "Jolene", artist: "Marigold June", art: image.jolene, duration: "3:04" },
  { title: "Night Rider", artist: "Sloane Vega, Meridian", art: image.rider, duration: "3:33" },
  { title: "Last Thing on My Mind", artist: "Cora Lane, Harlow", art: image.garden, duration: "3:44" },
  { title: "There Was Light", artist: "Jack Wilder, Cora Lane", art: image.rain, duration: "4:02" },
];

const albums: Track[] = [
  { title: "I'm The Problem", artist: "Morgan Vale", art: image.jolene, duration: "3:22" },
  { title: "DeBÍ TiRAR MáS FOTOS", artist: "Bad Bunny", art: image.garden, duration: "3:51" },
  { title: "10 Hours of Continuous Rain", artist: "Rain Sounds", art: image.rain, duration: "10:00:00" },
  { title: "HIT ME HARD AND SOFT", artist: "Billie Eilish", art: image.studio, duration: "3:48" },
];

const artists = [
  { name: "Kendrick Lamar", art: image.kendrick },
  { name: "Drake", art: image.drake },
  { name: "The Weeknd", art: image.weeknd },
  { name: "Morgan Wallen", art: image.wallen },
];

const radio = [
  { title: "Morgan Wallen Radio", name: "With Bailey Zimmerman, Tucker…", art: image.rider, tone: "lavender" },
  { title: "Zach Bryan Radio", name: "With Tyler Childers, Dylan Gossett…", art: image.jolene, tone: "pink" },
  { title: "Drake Radio", name: "With J. Cole, PARTYNEXTDOOR…", art: image.kendrick, tone: "rose" },
  { title: "Fleetwood Mac Radio", name: "With Elton John, Eagles, Billy Joel…", art: image.garden, tone: "amber" },
];

const charts = [
  { title: "Top\nSongs\nGlobal", meta: "Weekly Music Charts", className: "global" },
  { title: "Top\nSongs\nUSA", meta: "Weekly Music Charts", className: "usa" },
  { title: "Top 50", meta: "Global", className: "top50" },
  { title: "Top 50", meta: "USA", className: "top50usa" },
];

function PlayAction({ onClick, label = "Play track" }: { onClick: () => void; label?: string }) {
  return (
    <button className="card-play" onClick={onClick} aria-label={label}>
      <Play size={18} fill="currentColor" />
    </button>
  );
}

function SectionHeader({ title, onShowAll }: { title: string; onShowAll: () => void }) {
  return (
    <div className="section-header">
      <h2>{title}</h2>
      <button onClick={onShowAll}>Show all</button>
    </div>
  );
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [notice, setNotice] = useState("");
  const searchResults = useMemo(() => {
    const searchTerm = query.trim().toLowerCase();
    return [...trending, ...albums].filter((track) =>
      `${track.title} ${track.artist}`.toLowerCase().includes(searchTerm),
    );
  }, [query]);

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2200);
  };

  const beginTrack = (track: Track) => {
    setCurrentTrack(track);
    setIsPlaying(true);
  };

  return (
    <div className="pulse-app">
      <header className="site-header">
        <button className="mobile-menu" aria-label="Open menu"><Menu size={20} /></button>
        <a className="brand" href="#top" aria-label="Pulse home">
          <img src={image.logo} alt="" />
          <span>PULSE</span>
        </a>
        <button className="home-button" aria-label="Home"><HomeIcon size={21} fill="currentColor" /></button>
        <label className="top-search">
          <Search size={22} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="What do you want to play?" aria-label="Search songs and artists" />
          <span className="search-key">⌘</span>
        </label>
        <nav className="utility-links" aria-label="Utility navigation">
          <a href="#plans">Premium</a><a href="#support">Support</a><a href="#download">Download</a>
        </nav>
        <span className="nav-rule" />
        <button className="install-button" onClick={() => showNotice("Desktop app download is coming soon.")}><ArrowDownToLine size={16} /> Install App</button>
        <button className="signup-link" onClick={() => showNotice("Create a Pulse profile when the service launches.")}>Sign up</button>
        <button className="login-button" onClick={() => showNotice("Log in is available in the full player.")}>Log in</button>
      </header>

      <div className="app-frame" id="top">
        <aside className="shell-sidebar" aria-label="Library controls">
          <div className="library-heading"><strong>Your Library</strong><button onClick={() => showNotice("A new playlist workspace is ready.")} aria-label="Create playlist"><CirclePlus size={24} /></button></div>
          <div className="side-card">
            <h3>Create your first playlist</h3><p>It’s easy, we’ll help you</p>
            <button onClick={() => showNotice("Playlist creation is staged for the full player.")}>Create playlist</button>
          </div>
          <div className="side-card podcast-card">
            <h3>Let’s find some podcasts to follow</h3><p>We’ll keep you updated on new episodes</p>
            <button onClick={() => showNotice("Podcast browsing will be available soon.")}>Browse podcasts</button>
          </div>
          <div className="sidebar-bottom">
            <div className="legal-links"><a href="#legal">Legal</a><a href="#privacy">Safety & Privacy Center</a><a href="#privacy">Privacy Policy</a><a href="#cookies">Cookies</a><a href="#ads">About Ads</a><a href="#access">Accessibility</a><a href="#notice">Notice at Collection</a><a href="#choice">Your Privacy Choices <i>✓</i></a><a href="#cookies">Cookies</a></div>
            <button className="language-button"><Globe2 size={17} /> English</button>
          </div>
        </aside>

        <main className="browse-surface">
          {query.trim() ? (
            <section className="search-results" aria-live="polite">
              <div className="result-title-row"><div><p className="eyebrow">Search results</p><h1>Results for “{query}”</h1></div><button onClick={() => setQuery("")} className="clear-search"><X size={17} /> Clear</button></div>
              {searchResults.length ? (
                <>
                  <h2 className="result-label">Top result</h2>
                  <article className="top-result-card" onClick={() => beginTrack(searchResults[0])} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && beginTrack(searchResults[0])}>
                    <img src={searchResults[0].art} alt="" /><div><p className="track-kicker">Song</p><h3>{searchResults[0].title}</h3><p>{searchResults[0].artist}</p></div><PlayAction onClick={() => beginTrack(searchResults[0])} />
                  </article>
                  <h2 className="result-label songs-heading">Songs</h2>
                  <div className="song-list">
                    {searchResults.map((track, index) => <button className="song-row" key={`${track.title}-${index}`} onClick={() => beginTrack(track)}><span className="song-index">{currentTrack?.title === track.title && isPlaying ? <span className="equalizer"><i /><i /><i /></span> : index + 1}</span><img src={track.art} alt="" /><span className="song-data"><b>{track.title}</b><small>{track.artist}</small></span><span className="song-duration">{track.duration}</span><MoreHorizontal size={20} /></button>)}
                  </div>
                </>
              ) : <div className="empty-results"><Search size={32} /><h2>No matching music yet</h2><p>Try a song title or artist from the shelves below.</p></div>}
            </section>
          ) : (
            <div className="browse-content">
              <section className="music-section">
                <SectionHeader title="Trending songs" onShowAll={() => showNotice("Showing the trending shelf.")} />
                <div className="music-grid">
                  {trending.map((track) => <article className="media-card" key={track.title}><div className="art-wrap"><img src={track.art} alt="" /><PlayAction onClick={() => beginTrack(track)} /></div><h3>{track.title}</h3><p>{track.artist}</p></article>)}
                </div>
              </section>
              <section className="music-section artists-section">
                <SectionHeader title="Popular artists" onShowAll={() => showNotice("Artist directory will be available soon.")} />
                <div className="artist-grid">
                  {artists.map((artist) => <article className="artist-card" key={artist.name}><button className="artist-image" onClick={() => showNotice(`${artist.name} radio is ready to explore.`)}><img src={artist.art} alt="" /></button><h3>{artist.name}</h3><p>Artist</p></article>)}
                </div>
              </section>
              <section className="music-section">
                <SectionHeader title="Popular albums and singles" onShowAll={() => showNotice("Showing the most played new releases.")} />
                <div className="music-grid">
                  {albums.map((track) => <article className="media-card" key={track.title}><div className="art-wrap"><img src={track.art} alt="" /><PlayAction onClick={() => beginTrack(track)} /></div><h3>{track.title}</h3><p>{track.artist}</p></article>)}
                </div>
              </section>
              <section className="music-section">
                <SectionHeader title="Popular radio" onShowAll={() => showNotice("More stations are being tuned.")} />
                <div className="music-grid">
                  {radio.map((station) => <article className="media-card station-card" key={station.title}><button className={`station-cover ${station.tone}`} onClick={() => beginTrack({ title: station.title, artist: station.name, art: station.art, duration: "Live" })}><img src={station.art} alt="" /><span className="mini-brand">P</span><b>RADIO</b><strong>{station.title.replace(" Radio", "")}</strong></button><h3>{station.name}</h3><p>{station.name}</p></article>)}
                </div>
              </section>
              <section className="music-section charts-section">
                <SectionHeader title="Featured Charts" onShowAll={() => showNotice("Chart archives will be available soon.")} />
                <div className="music-grid">
                  {charts.map((chart) => <article className="media-card chart-card" key={chart.className}><button className={`chart-cover ${chart.className}`} onClick={() => showNotice(`${chart.meta} opened.`)}><span className="mini-brand">P</span><strong>{chart.title.split("\n").map((word) => <span key={word}>{word}</span>)}</strong><em>{chart.className.includes("usa") ? "USA" : "GLOBAL"}</em><small>↗ &nbsp; {chart.meta}</small></button><p>Your weekly update of the most played...</p></article>)}
                </div>
              </section>
              <footer className="site-footer" id="plans">
                <div className="footer-links"><div><h3>Company</h3><a href="#about">About</a><a href="#jobs">Jobs</a><a href="#record">For the Record</a></div><div><h3>Communities</h3><a href="#artists">For Artists</a><a href="#devs">Developers</a><a href="#ads">Advertising</a><a href="#investors">Investors</a><a href="#vendors">Vendors</a></div><div><h3>Useful links</h3><a href="#support">Support</a><a href="#mobile">Free Mobile App</a><a href="#country">Popular by Country</a><a href="#import">Import your music</a></div><div><h3>Pulse Plans</h3><a href="#premium">Premium Individual</a><a href="#duo">Premium Duo</a><a href="#family">Premium Family</a><a href="#student">Premium Student</a><a href="#free">Pulse Free</a><a href="#books">Audiobooks Access</a></div><div className="socials"><button aria-label="Instagram">◎</button><button aria-label="X">𝕏</button><button aria-label="Facebook">f</button></div></div>
                <div className="copyright">© 2026 Pulse Audio</div>
              </footer>
            </div>
          )}
        </main>
        <aside className="right-rail" aria-hidden="true"><ChevronLeft size={21} /></aside>
      </div>

      {notice && <div className="notice" role="status">{notice}</div>}
      {currentTrack ? (
        <section className="music-player" aria-label="Now playing"><div className="player-track"><img src={currentTrack.art} alt="" /><div><b>{currentTrack.title}</b><span>{currentTrack.artist}</span></div><button aria-label="Like current song"><Heart size={18} /></button></div><div className="player-controls"><div><button aria-label="Previous track"><SkipBack size={18} fill="currentColor" /></button><button className="round-play" onClick={() => setIsPlaying(!isPlaying)} aria-label={isPlaying ? "Pause" : "Play"}>{isPlaying ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}</button><button aria-label="Next track"><SkipForward size={18} fill="currentColor" /></button></div><div className="progress"><span>0:42</span><div><i /></div><span>{currentTrack.duration}</span></div></div><div className="player-volume"><Volume2 size={18} /><div><i /></div><Speaker size={17} /></div></section>
      ) : (
        <section className="join-strip"><div><b>Preview of Pulse</b><span>Listen to full songs and podcasts with occasional ads. No card required.</span></div><button onClick={() => showNotice("Pulse is currently in preview.")}>Sign up free</button></section>
      )}
    </div>
  );
}
