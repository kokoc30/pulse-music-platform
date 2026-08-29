import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { AUDIUS_LINKS, EXTERNAL_LINKS } from '@/lib/links'

/**
 * A short, truthful statement of what leaves the visitor's browser.
 *
 * agents/26 → "Privacy" asks for a lightweight disclosure and explicitly warns
 * against writing legal guarantees. So this page says only what the code
 * actually does, in the order a visitor would ask it, and links to each
 * provider's own policy rather than paraphrasing them.
 *
 * Everything here is verifiable from the source: there is no account system, no
 * database, no analytics script and no tracking pixel in this application.
 */
export function PrivacyPage() {
  useEffect(() => {
    document.title = 'Privacy — Pulse'
    return () => {
      document.title = 'Pulse — Music Discovery'
    }
  }, [])

  return (
    <section className="search-results prose-page">
      <div className="result-title-row">
        <div>
          <p className="eyebrow">About this app</p>
          <h1>Privacy</h1>
        </div>
      </div>

      <div className="prose">
        <h2>There is no account and no database</h2>
        <p>
          Pulse has no sign-up, no login and no user profiles, and it stores nothing about you on a
          server. What it does keep, it keeps in this browser: your player volume, mute and playback
          settings; the songs and playlists you save to Your Library; and — if you turn it on — a
          listening history used to personalise your home page. Clearing your browser data removes
          all of it.
        </p>

        <h2>Personalised home page, stored on this device</h2>
        <p>
          Pulse can remember what you play and search for so that your home page shows{' '}
          <i>Recommended for you</i> and <i>Recently played</i> instead of the same charts every
          visit. This is off until you choose to turn it on, and you are asked once, in the page
          itself.
        </p>
        <p>When it is on, this is what is kept and where:</p>
        <ul>
          <li>
            <b>Where it lives.</b> In this browser&rsquo;s <code>localStorage</code>, under a single
            key. It is never sent to a Pulse server — there is no Pulse server that receives it, and
            no account to attach it to.
          </li>
          <li>
            <b>It does not follow you.</b> Because it is stored per browser, it does not sync to
            your phone, to another browser on this machine, or to a private window. Each is separate,
            and each starts empty.
          </li>
          <li>
            <b>What is stored.</b> For music you play: title, artist, cover image addresses, duration,
            the provider&rsquo;s page for it, how long you listened, how many times, and when. For
            searches: only queries you actually submit — what you type is never recorded
            keystroke-by-keystroke.
          </li>
          <li>
            <b>How long.</b> Up to 250 items, and up to 180 days since you last played them.
            YouTube items follow a shorter rule, described below.
          </li>
          <li>
            <b>What is never stored.</b> Audio or video files, stream addresses, API keys, or any
            credential.
          </li>
          <li>
            <b>Preferences, not conclusions about you.</b> Pulse records the artists, tags and
            searches you interact with, including the alphabet a search was typed in so that results
            in that alphabet can be ranked more usefully. It does not infer or store your
            nationality, ethnicity, language, religion or any other personal characteristic, and no
            part of the app claims to know one.
          </li>
        </ul>
        <p>
          You can switch it off, or delete what has been stored, at any time on the{' '}
          <Link to="/settings">Settings</Link> page. Turning it off deletes what was already there.
          With it off, search, playback and the queue all work exactly as before, and your home page
          shows the general discovery shelves.
        </p>

        <h2>Your Library is saved on this device only</h2>
        <p>
          Liking a song or making a playlist in Pulse saves it in <b>this browser</b>, in its own
          storage area, separately from your listening history. There is no Pulse account and no
          cloud sync, so:
        </p>
        <ul>
          <li>
            <b>It does not follow you.</b> Your library exists in this browser on this device.
            Another browser, another phone or a private window each starts empty.
          </li>
          <li>
            <b>Nothing about a provider account changes.</b> Pulse is not signed in to Audius,
            Jamendo or YouTube — it has no login for any of them. A heart in Pulse is a record in
            this browser and nothing else, which is why the app says <i>Liked in Pulse</i> and{' '}
            <i>Saved to a Pulse playlist</i> rather than just &ldquo;liked&rdquo;. Deleting your
            Pulse library removes nothing from those services, and never did anything to them in the
            first place.
          </li>
          <li>
            <b>What is stored for each saved song.</b> Its provider and id, title, artist, the
            address of its cover image, its duration, and the provider&rsquo;s own page for it —
            the same things already on your screen. Playlists additionally store the name and
            description you typed and the order you put the songs in.
          </li>
          <li>
            <b>What is never stored.</b> Audio or video files, stream addresses, API keys, or any
            credential. Because no stream address is kept, playing something from your library asks
            the provider for it again at that moment.
          </li>
          <li>
            <b>Not interested.</b> If you hide a suggestion, Pulse records only that one item&rsquo;s
            id so it can stop showing it. It records no reason, and draws no conclusion about you
            from it.
          </li>
        </ul>
        <p>
          <b>YouTube items saved to your library follow the shorter YouTube rule</b> described below:
          they are deleted automatically within 30 days, whether they are in Liked Songs or in a
          playlist.
        </p>
        <p>
          You can delete your whole library at any time with <i>Clear Library</i> on the{' '}
          <Link to="/settings">Settings</Link> page. That removes your Liked Songs, your playlists
          and your hidden suggestions, and — because those saves are themselves what shapes your
          recommendations — their influence on what Pulse suggests. It does not touch your listening
          history, your searches, or your volume and playback settings, which are cleared by their
          own separate controls.
        </p>

        <h2>Music comes from three external providers</h2>
        <p>
          Pulse does not host any music. It searches and plays catalogues that belong to other
          companies, and using it means your browser talks to them:
        </p>
        <ul>
          <li>
            <b>Audius</b> — searched from your browser, and audio streams directly from Audius
            content nodes.{' '}
            <a href={AUDIUS_LINKS.privacy} target="_blank" rel="noopener">
              Audius privacy policy
            </a>
            .
          </li>
          <li>
            <b>Jamendo</b> — searched through this site&rsquo;s own <code>/api/jamendo</code> route so
            the credential stays on the server; audio and cover images then load directly from
            Jamendo.{' '}
            <a href={EXTERNAL_LINKS.jamendoPrivacy} target="_blank" rel="noopener">
              Jamendo privacy policy
            </a>
            .
          </li>
          <li>
            <b>YouTube</b> — an optional fallback, described below.
          </li>
        </ul>

        <h2>YouTube and Google</h2>
        <p>
          YouTube is used in two places, and only ever because you asked for it:
        </p>
        <ul>
          <li>
            <b>Search.</b> Nothing is sent to YouTube while you type. A YouTube search happens only
            when you press <i>Search YouTube</i>, and it goes through this site&rsquo;s own{' '}
            <code>/api/youtube</code> route, which asks the YouTube Data API for video titles,
            channel names, thumbnails and durations. Your search text is sent to Google as part of
            that request.
          </li>
          <li>
            <b>Playback.</b> If you play a YouTube result, it plays in YouTube&rsquo;s own embedded
            player, loaded from YouTube. That player is a piece of YouTube running inside this page:
            YouTube and Google may receive your IP address, browser information, the page you are on
            and what you watched, and may set or read cookies, exactly as they would on
            youtube.com. Ads are YouTube&rsquo;s and are not altered here.
          </li>
        </ul>
        <p>
          No YouTube player is loaded when the site opens. The YouTube player script is not fetched
          at all until the first time you play a video, so simply visiting Pulse or running an
          ordinary search contacts neither YouTube nor Google.
        </p>
        <p>
          <b>Your home page never spends a YouTube search.</b> Personalised recommendations are built
          only from the Audius and Jamendo catalogues that the page already loads. Opening or
          reloading Pulse makes no YouTube request of any kind, however much you have watched.
        </p>

        <h3>YouTube videos in your history and your library</h3>
        <p>
          If personalisation is on and you play a YouTube video, Pulse remembers it so it can appear
          in <i>Recently played</i>. YouTube&rsquo;s API rules govern that copy, and they are
          stricter than the rules for the music catalogues:
        </p>
        <ul>
          <li>
            Only what is already on your screen is kept: the title, the channel name, the address of
            YouTube&rsquo;s own thumbnail, the duration and the link to the watch page.
          </li>
          <li>
            <b>It is deleted within 30 days</b>, and sooner if you clear it. Playing the video again
            refreshes it. Pulse checks and removes expired entries when it starts and periodically
            while it is open.
          </li>
          <li>
            <b>The same 30-day limit applies to a YouTube video you save.</b> If you like a YouTube
            result or add one to a playlist, that saved copy expires too — and when it does, Pulse
            deletes the whole saved item, including its place in your Liked Songs and in any
            playlist. It does not keep a nameless placeholder. To keep such a video, search for it
            again and save it again.
          </li>
          <li>
            <b>No view counts, likes, ratings or engagement figures are stored</b> — Pulse never
            asks YouTube for them in the first place.
          </li>
          <li>
            <b>YouTube data plays no part in your music recommendations.</b> Your suggestions are
            worked out only from Audius and Jamendo listening, from Audius and Jamendo tracks you
            saved, and from searches you typed yourself. Liking a YouTube video changes nothing about
            what Pulse recommends.
          </li>
          <li>
            No video or audio is ever downloaded, copied or stored. Playback always goes through
            YouTube&rsquo;s own player, and the thumbnail is loaded from YouTube, not re-hosted here.
          </li>
        </ul>
        <p>
          <a href={EXTERNAL_LINKS.googlePrivacy} target="_blank" rel="noopener">
            Google privacy policy
          </a>{' '}
          ·{' '}
          <a href={EXTERNAL_LINKS.youtubeTerms} target="_blank" rel="noopener">
            YouTube Terms of Service
          </a>
        </p>

        <h2>What Pulse does not do</h2>
        <ul>
          <li>It does not download, copy, re-host or proxy any audio or video.</li>
          <li>It does not separate the audio from a YouTube video, or play YouTube in the background.</li>
          <li>
            It does not upload your listening history anywhere. The history and the preferences
            derived from it exist only in this browser, and Pulse has no server that could receive
            them.
          </li>
          <li>
            It does not link that history to an identity. There is no account, no login and no
            identifier that persists beyond this browser&rsquo;s storage.
          </li>
          <li>
            It does not act on your behalf on any provider. It does not favourite, like, follow,
            subscribe, or create a playlist on Audius, Jamendo or YouTube, and it has no permission
            to — there is no provider sign-in anywhere in this app.
          </li>
          <li>It runs no analytics, no advertising and no third-party tracking scripts of its own.</li>
          <li>
            It does not store provider results anywhere permanent. A YouTube search you repeat in the
            same tab is answered from memory, and that memory is gone when the tab closes.
          </li>
        </ul>

        <h2>Videos made for kids</h2>
        <p>
          When a YouTube video is marked as made for kids, Pulse does not embed it. It stays in the
          results with a link to watch it on YouTube instead, where YouTube applies its own handling
          for child-directed content.
        </p>

        <p className="prose-back">
          <Link to="/">Back to Pulse</Link>
        </p>
      </div>
    </section>
  )
}
