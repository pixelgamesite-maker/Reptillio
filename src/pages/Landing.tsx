import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useSound } from "../hooks/useSound";
import { XGlyph } from "../components/Icons";

/**
 * First thing signed-out visitors see: the key art full-screen and one
 * button. Signing in drops them on the Chapters page. A ?ref= code in the
 * URL is already captured by App, so it survives the X round trip.
 */
export default function Landing() {
  const { signInWithX, loading } = useAuth();
  const { play } = useSound();

  return (
    <div className="landing">
      <img
        className="landing-art"
        src="/landing/hero.jpg"
        srcSet="/landing/hero-1080.jpg 1080w, /landing/hero.jpg 1920w"
        sizes="(max-aspect-ratio: 1/1) 220vh, 100vw"
        alt=""
        fetchPriority="high"
        draggable={false}
      />
      <div className="landing-shade" aria-hidden="true" />

      <main className="landing-center">
        <h1 className="landing-title">Reptilio</h1>
        <p className="landing-tag">Hatch an egg. Evolve your reptile. Claim your whitelist spot.</p>
        <button
          className="landing-cta"
          disabled={loading}
          onClick={() => {
            play("select");
            signInWithX("/");
          }}
        >
          <XGlyph size={22} />
          <span>Connect with X</span>
        </button>
        <p className="landing-note">Free Genesis Egg on sign-in · No wallet needed to start</p>
      </main>

      <footer className="landing-foot">
        <Link to="/den">Peek at the leaderboard →</Link>
      </footer>
    </div>
  );
}
