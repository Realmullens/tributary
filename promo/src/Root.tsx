import { Composition, Still } from "remotion";
import { Banner, FeatureCard, HeroCard } from "./Cards";
import { Promo, PROMO_DURATION } from "./Promo";

export function RemotionRoot() {
  return (
    <>
      <Composition
        id="promo"
        component={Promo}
        durationInFrames={PROMO_DURATION}
        fps={30}
        width={1920}
        height={1080}
      />
      <Still id="card-hero" component={HeroCard} width={1600} height={900} />
      <Still
        id="card-local"
        component={() => (
          <FeatureCard
            pill="Local-first recording"
            headline={
              <>
                The call can drop. <br />
                The recording <span style={{ color: "#fb3b4e" }}>can&rsquo;t</span>.
              </>
            }
            sub="Every participant records their own camera and mic on-device — chunks hit IndexedDB before upload, resume after crashes, refreshes, even killed tabs."
            image="still-recording.png"
          />
        )}
        width={1600}
        height={900}
      />
      <Still
        id="card-tracks"
        component={() => (
          <FeatureCard
            pill="Post-production built in"
            headline={<>Separate synced tracks, ready for your editor.</>}
            sub="Per-guest MP4 + 48 kHz WAV, mixed grid exports, Premiere/FCP XML timelines — offsets aligned automatically via clock sync."
            image="session.png"
          />
        )}
        width={1600}
        height={900}
      />
      <Still
        id="card-editor"
        component={() => (
          <FeatureCard
            pill="Text-based editing"
            headline={<>Delete the words. The video follows.</>}
            sub="Whisper transcription with speaker labels from separate tracks. Select filler words in the transcript, cut them, export — plus 9:16 social clips with captions."
            image="still-editor.png"
          />
        )}
        width={1600}
        height={900}
      />
      <Still
        id="card-agents"
        component={() => (
          <FeatureCard
            pill="AI-agent native"
            headline={
              <>
                Your AI agent is <br />
                the producer.
              </>
            }
            sub="The tributary CLI exposes transcripts, word timestamps, cuts, clips and enhancement as JSON commands — point Claude Code or any agent at your episode."
            image="still-editor.png"
          />
        )}
        width={1600}
        height={900}
      />
      <Still id="banner" component={Banner} width={1280} height={640} />
    </>
  );
}
