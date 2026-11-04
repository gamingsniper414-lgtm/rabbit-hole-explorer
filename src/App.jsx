import { useEffect, useRef, useState } from "react";
import { starterTopics, surpriseTopics } from "./data/starterTopics";
import "./App.css";

const API_URL = "https://en.wikipedia.org/w/api.php";
const FAVORITES_KEY = "rabbit-hole-favorites";

// Build a safely encoded Wikipedia API URL.
function buildApiUrl(parameters) {
  const url = new URL(API_URL);

  Object.entries({
    ...parameters,
    format: "json",
    origin: "*",
  }).forEach(([key, value]) => {
    url.searchParams.set(key, String(value));
  });

  return url.toString();
}

// Request information from Wikipedia.
async function fetchWikipedia(parameters, signal) {
  const response = await fetch(buildApiUrl(parameters), { signal });

  if (!response.ok) {
    throw new Error("Wikipedia returned an unexpected response.");
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error.info || "Wikipedia could not complete the request.");
  }

  return data;
}

// Load saved favorites from this browser.
function loadFavorites() {
  try {
    const saved = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");

    if (!Array.isArray(saved)) return [];

    return [...new Set(saved.filter((item) => typeof item === "string"))];
  } catch {
    return [];
  }
}

function ArrowIcon({ diagonal = false }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      {diagonal ? (
        <path d="M7 17 17 7M8 7h9v9" />
      ) : (
        <path d="M4 12h15M14 7l5 5-5 5" />
      )}
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
    >
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 4.5 4.5" />
    </svg>
  );
}

function CompassMark() {
  return (
    <svg
      className="compass-mark"
      aria-hidden="true"
      viewBox="0 0 120 120"
      fill="none"
    >
      <circle cx="60" cy="60" r="45" />
      <circle cx="60" cy="60" r="31" />
      <path d="M60 4v112M4 60h112M20 20l80 80M100 20l-80 80" />
      <path d="m60 27 8 25 25 8-25 8-8 25-8-25-25-8 25-8z" />
      <circle cx="60" cy="60" r="4" />
    </svg>
  );
}

function App() {
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchStatus, setSearchStatus] = useState("idle");
  const [searchError, setSearchError] = useState("");

  const [trail, setTrail] = useState([]);
  const [article, setArticle] = useState(null);
  const [articleStatus, setArticleStatus] = useState("idle");
  const [articleError, setArticleError] = useState("");
  const [related, setRelated] = useState([]);
  const [relatedStatus, setRelatedStatus] = useState("idle");

  const [favorites, setFavorites] = useState(loadFavorites);
  const [favoriteError, setFavoriteError] = useState("");
  const [retryCount, setRetryCount] = useState(0);

  const searchController = useRef(null);
  const searchSequence = useRef(0);
  const articleHeadingRef = useRef(null);

  const currentTitle = trail[trail.length - 1] || null;

  // Save favorites in this visitor's browser.
  useEffect(() => {
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
      setFavoriteError("");
    } catch {
      setFavoriteError(
        "Favorites could not be saved on this device. They may disappear when you leave."
      );
    }
  }, [favorites]);

  // Cancel an active search when the application closes.
  useEffect(() => {
    return () => {
      searchController.current?.abort();
    };
  }, []);

  // Load the selected article and its related topics.
  useEffect(() => {
    if (!currentTitle) return undefined;

    const controller = new AbortController();

    async function loadArticle() {
      setArticle(null);
      setRelated([]);
      setArticleStatus("loading");
      setRelatedStatus("loading");
      setArticleError("");

      try {
        const data = await fetchWikipedia(
          {
            action: "query",
            prop: "extracts|info",
            exintro: 1,
            explaintext: 1,
            exsentences: 4,
            inprop: "url",
            redirects: 1,
            titles: currentTitle,
          },
          controller.signal
        );

        const pages = Object.values(data.query?.pages || {});
        const page = pages.find((item) => !("missing" in item));

        if (!page) {
          throw new Error("We couldn't find that Wikipedia article.");
        }

        const articleTitle = page.title;

        setArticle({
          title: articleTitle,
          extract: page.extract || "",
          url:
            page.fullurl ||
            `https://en.wikipedia.org/wiki/${encodeURIComponent(
              articleTitle.replaceAll(" ", "_")
            )}`,
        });

        setArticleStatus("success");

        try {
          const linksData = await fetchWikipedia(
            {
              action: "query",
              prop: "links",
              plnamespace: 0,
              pllimit: 30,
              titles: articleTitle,
            },
            controller.signal
          );

          const linkPages = Object.values(linksData.query?.pages || {});
          const links = linkPages.flatMap((item) => item.links || []);
          const seen = new Set([articleTitle.toLocaleLowerCase()]);

          const titles = links
            .map((item) => item.title)
            .filter((title) => {
              if (typeof title !== "string") return false;

              const key = title.toLocaleLowerCase();

              if (seen.has(key)) return false;

              seen.add(key);
              return true;
            })
            .slice(0, 8);

          setRelated(titles);
          setRelatedStatus("success");
        } catch (error) {
          if (error.name !== "AbortError") {
            setRelatedStatus("error");
          }
        }
      } catch (error) {
        if (error.name !== "AbortError") {
          setArticleError(
            error.message || "Something went wrong while loading this article."
          );

          setArticleStatus("error");
          setRelatedStatus("idle");
        }
      }
    }

    loadArticle();

    return () => controller.abort();
  }, [currentTitle, retryCount]);

  // Move keyboard focus to the article after it loads.
  useEffect(() => {
    if (articleStatus === "success") {
      articleHeadingRef.current?.focus();
    }
  }, [articleStatus]);

  // Search Wikipedia for article titles.
  async function handleSearch(event) {
    event.preventDefault();

    const term = query.trim();

    searchController.current?.abort();
    const sequence = ++searchSequence.current;

    if (!term) {
      setSearchResults([]);
      setSearchStatus("idle");
      setSearchError("Enter a topic to start exploring.");
      return;
    }

    const controller = new AbortController();
    searchController.current = controller;

    setSearchStatus("loading");
    setSearchResults([]);
    setSearchError("");

    try {
      const data = await fetchWikipedia(
        {
          action: "opensearch",
          search: term,
          limit: 6,
          namespace: 0,
        },
        controller.signal
      );

      if (sequence !== searchSequence.current) return;

      const titles = Array.isArray(data[1])
        ? data[1].filter((title) => typeof title === "string")
        : [];

      setSearchResults(titles);
      setSearchStatus(titles.length ? "success" : "empty");
    } catch (error) {
      if (error.name === "AbortError" || sequence !== searchSequence.current) {
        return;
      }

      setSearchStatus("error");
      setSearchError(
        "We couldn't reach Wikipedia. Check your connection and try again."
      );
    }
  }

  function resetSearch() {
    searchController.current?.abort();
    searchSequence.current += 1;
    setSearchStatus("idle");
    setSearchResults([]);
    setSearchError("");
  }

  // Open a topic from the current article.
  function openTopic(title) {
    resetSearch();
    setTrail((previous) => [...previous, title]);
    window.scrollTo(0, 0);
  }

  // Start a new trail from the homepage.
  function openFromHome(title) {
    resetSearch();
    setTrail([title]);
    window.scrollTo(0, 0);
  }

  function goHome() {
    resetSearch();
    setTrail([]);
    setArticle(null);
    window.scrollTo(0, 0);
  }

  function goBack() {
    if (trail.length <= 1) {
      goHome();
      return;
    }

    setTrail((previous) => previous.slice(0, -1));
    window.scrollTo(0, 0);
  }

  function visitTrail(index) {
    if (index === trail.length - 1) return;

    setTrail((previous) => previous.slice(0, index + 1));
    window.scrollTo(0, 0);
  }

  function toggleFavorite(title) {
    setFavorites((previous) =>
      previous.includes(title)
        ? previous.filter((item) => item !== title)
        : [...previous, title]
    );
  }

  function surpriseMe() {
    const index = Math.floor(Math.random() * surpriseTopics.length);
    openFromHome(surpriseTopics[index]);
  }

  const isFavorite = article ? favorites.includes(article.title) : false;

  return (
    <div className="site-shell">
      <header className="site-header">
        <div className="header-inner">
          <button
            className="brand"
            onClick={goHome}
            aria-label="Rabbit Hole home"
          >
            <span className="brand-symbol" aria-hidden="true">
              ✳
            </span>

            <span>
              rabbit hole<span className="brand-period">.</span>
            </span>
          </button>

          <div className="header-note">
            <span className="status-dot" aria-hidden="true" />
            A FIELD GUIDE FOR THE CURIOUS
          </div>
        </div>
      </header>

      <main>
        {!currentTitle ? (
          <>
            <section className="hero section-wrap" aria-labelledby="home-heading">
              <div className="hero-copy">
                <div className="eyebrow">
                  <span className="eyebrow-line" />
                  YOUR NEXT DISCOVERY STARTS HERE
                </div>

                <h1 id="home-heading">
                  Follow what
                  <br />
                  makes you <em>curious.</em>
                </h1>

                <p className="hero-description">
                  One question leads to another. Explore a topic, follow its
                  connections, and see where curiosity takes you.
                </p>

                <form className="search-form" onSubmit={handleSearch}>
                  <label className="sr-only" htmlFor="topic-search">
                    Search Wikipedia topics
                  </label>

                  <span className="search-icon">
                    <SearchIcon />
                  </span>

                  <input
                    id="topic-search"
                    type="search"
                    placeholder="What are you curious about?"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    autoComplete="off"
                  />

                  <button type="submit">
                    Explore <ArrowIcon />
                  </button>
                </form>

                <div className="search-feedback" aria-live="polite">
                  {searchStatus === "loading" && (
                    <p className="feedback-message">
                      Searching Wikipedia…
                    </p>
                  )}

                  {searchError && (
                    <p className="feedback-message feedback-error">
                      {searchError}
                    </p>
                  )}

                  {searchStatus === "empty" && (
                    <p className="feedback-message">
                      No results found. Try a different search or explore an
                      example below.
                    </p>
                  )}

                  {searchStatus === "success" && (
                    <div className="search-results">
                      <p className="results-label">SEARCH RESULTS</p>

                      <ul>
                        {searchResults.map((title) => (
                          <li key={title}>
                            <button
                              type="button"
                              onClick={() => openFromHome(title)}
                            >
                              <span>{title}</span>
                              <ArrowIcon />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="example-row">
                  <span>TRY A TRAIL:</span>

                  <div className="example-buttons">
                    {starterTopics.map((topic) => (
                      <button
                        key={topic}
                        type="button"
                        onClick={() => openFromHome(topic)}
                      >
                        {topic}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  className="surprise-button"
                  type="button"
                  onClick={surpriseMe}
                >
                  <span aria-hidden="true">✳</span>
                  Surprise me
                  <ArrowIcon />
                </button>
              </div>

              <div className="hero-art" aria-hidden="true">
                <div className="art-grid" />
                <div className="art-orbit orbit-one" />
                <div className="art-orbit orbit-two" />

                <div className="art-center">
                  <CompassMark />
                </div>

                <span className="art-star star-one">✦</span>
                <span className="art-star star-two">✧</span>
                <span className="art-star star-three">✳</span>
                <span className="art-coordinate coordinate-one">UNKNOWN</span>
                <span className="art-coordinate coordinate-two">EXPLORE ↗</span>
                <span className="art-number">01 / ∞</span>
              </div>
            </section>

            <section className="home-bottom section-wrap">
              <div className="intro-note">
                <span className="section-index">01 / THE IDEA</span>

                <h2>
                  A little more wondering.
                  <br />
                  A little less scrolling.
                </h2>

                <p>
                  Rabbit Hole is a field guide to the wonderfully connected
                  world of Wikipedia. Pick a subject and follow the threads.
                </p>
              </div>

              <div className="favorites-panel">
                <div className="panel-heading">
                  <div>
                    <span className="section-index">
                      02 / YOUR COLLECTION
                    </span>

                    <h2>Saved for later</h2>
                  </div>

                  <span className="favorite-count">
                    {favorites.length}
                  </span>
                </div>

                <p className="panel-description">
                  Topics you save stay in this browser.
                </p>

                {favoriteError && (
                  <p className="storage-warning" role="alert">
                    {favoriteError}
                  </p>
                )}

                {favorites.length === 0 ? (
                  <div className="empty-favorites">
                    <span aria-hidden="true">☆</span>
                    <p>No saved topics yet. Find something worth keeping.</p>
                  </div>
                ) : (
                  <ul className="favorite-list">
                    {favorites.map((title) => (
                      <li key={title}>
                        <button
                          className="favorite-open"
                          type="button"
                          onClick={() => openFromHome(title)}
                        >
                          {title}
                          <ArrowIcon />
                        </button>

                        <button
                          className="favorite-remove"
                          type="button"
                          onClick={() => toggleFavorite(title)}
                          aria-label={`Remove ${title} from favorites`}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </>
        ) : (
          <section className="explore-page section-wrap">
            <div className="explore-topline">
              <button className="back-button" type="button" onClick={goBack}>
                <span aria-hidden="true">←</span>
                {trail.length > 1 ? "Previous topic" : "Back to home"}
              </button>

              <span className="explore-index">
                FIELD NOTE / {String(trail.length).padStart(2, "0")}
              </span>
            </div>

            <nav className="trail" aria-label="Exploration trail">
              <span className="trail-label">YOUR TRAIL</span>

              <ol>
                {trail.map((title, index) => (
                  <li key={`${title}-${index}`}>
                    {index > 0 && (
                      <span className="trail-divider" aria-hidden="true">
                        /
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => visitTrail(index)}
                      aria-current={
                        index === trail.length - 1 ? "page" : undefined
                      }
                    >
                      {title}
                    </button>
                  </li>
                ))}
              </ol>
            </nav>

            {articleStatus === "loading" && (
              <div className="state-panel" role="status">
                <span className="state-symbol" aria-hidden="true">
                  ✳
                </span>

                <h1>Following the thread…</h1>
                <p>Finding your field note on Wikipedia.</p>
              </div>
            )}

            {articleStatus === "error" && (
              <div className="state-panel" role="alert">
                <span className="state-symbol" aria-hidden="true">
                  !
                </span>

                <h1>We couldn't open this topic.</h1>

                <p>
                  {articleError} Check your connection and try again.
                </p>

                <div className="state-actions">
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => setRetryCount((count) => count + 1)}
                  >
                    Try again
                  </button>

                  <button
                    className="text-button"
                    type="button"
                    onClick={goHome}
                  >
                    Explore example topics
                  </button>
                </div>
              </div>
            )}

            {articleStatus === "success" && article && (
              <>
                <article className="article-card">
                  <div className="article-main">
                    <div className="eyebrow">
                      <span className="eyebrow-line" />
                      A WIKIPEDIA FIELD NOTE
                    </div>

                    <h1 ref={articleHeadingRef} tabIndex="-1">
                      {article.title}
                    </h1>

                    <div className="article-rule" />

                    <p className="article-summary">
                      {article.extract ||
                        "Wikipedia doesn't provide an introductory summary for this topic. Visit the source article to learn more."}
                    </p>

                    <a
                      className="source-link"
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Read the Wikipedia article
                      <ArrowIcon diagonal />
                      <span className="sr-only">
                        {" "}(opens in a new tab)
                      </span>
                    </a>

                    <p className="attribution">
                      Summary and related links from Wikipedia.
                    </p>
                  </div>

                  <aside className="article-aside">
                    <span className="aside-label">
                      KEEP THIS DISCOVERY
                    </span>

                    <p>
                      Found something interesting? Save it for another day.
                    </p>

                    <button
                      className={`save-button ${isFavorite ? "is-saved" : ""}`}
                      type="button"
                      onClick={() => toggleFavorite(article.title)}
                      aria-pressed={isFavorite}
                    >
                      <span aria-hidden="true">
                        {isFavorite ? "★" : "☆"}
                      </span>

                      {isFavorite ? "Saved — remove" : "Save topic"}
                    </button>

                    {favoriteError && (
                      <p className="storage-warning" role="alert">
                        {favoriteError}
                      </p>
                    )}

                    <div className="aside-decoration" aria-hidden="true">
                      <CompassMark />
                    </div>
                  </aside>
                </article>

                <section
                  className="related-section"
                  aria-labelledby="related-heading"
                >
                  <div className="related-heading">
                    <div>
                      <span className="section-index">
                        FOLLOW THE THREAD
                      </span>

                      <h2 id="related-heading">Where to next?</h2>
                    </div>

                    <p>Connections from this Wikipedia article.</p>
                  </div>

                  {relatedStatus === "loading" && (
                    <p className="related-message" role="status">
                      Looking for related topics…
                    </p>
                  )}

                  {relatedStatus === "error" && (
                    <p className="related-message" role="alert">
                      Related topics couldn't be loaded. You can still read
                      the source article or return home to explore.
                    </p>
                  )}

                  {relatedStatus === "success" && related.length === 0 && (
                    <p className="related-message">
                      No related topics were found for this article.
                    </p>
                  )}

                  {relatedStatus === "success" && related.length > 0 && (
                    <div className="related-grid">
                      {related.map((title, index) => (
                        <button
                          className="related-card"
                          type="button"
                          key={title}
                          onClick={() => openTopic(title)}
                        >
                          <span className="related-number">
                            {String(index + 1).padStart(2, "0")} / DISCOVER
                          </span>

                          <span className="related-title">{title}</span>

                          <span className="related-arrow">
                            <ArrowIcon diagonal />
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}
          </section>
        )}
      </main>

      <footer className="site-footer">
        <div className="footer-inner">
          <span className="footer-brand">
            rabbit hole<span>.</span>
          </span>

          <p>Made for the endlessly curious.</p>

          <a
            href="https://www.wikipedia.org/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Powered by Wikipedia ↗
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
      </footer>
    </div>
  );
}

export default App;