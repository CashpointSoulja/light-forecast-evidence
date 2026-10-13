# Live release evidence

I published and independently checked this concept on 13 October 2026. All people, numbers and scenarios are synthetic. It is an independent portfolio concept, not an affiliated product or production service.

- Live demo: https://light-forecast-evidence.ayoahmed-49d.workers.dev
- Voiced public walkthrough: https://drive.google.com/file/d/1M5aUFwOwfDfJ3R3YPhmxIrunTlc9NVKR/view
- The video is a 100.6-second recording of the real public demo, not a mockup. It has pointer movement, narration and captions.
- Video access: anyone with the link can view, verified after upload.
- Reviewed code commit: `a74bfd039dd1576e69d59915074387b4318ef38b`
- Deployment version: `0c1f8dc6-160c-43fd-85e7-23e9f2887ed8`
- Hosting plan: Free, verified on deployment day. No paid plan or payment setup was used.

## Checks I ran

79/79 unit after transport correction. 31 expected/actual evaluations; 3 deliberate failures. 43/43 live UI checks including stale reset/reimport.

I checked sampled final video frames for readable states and captions, and checked the narration transcript against the demonstrated flow. The narration is a rough synthetic voice, not my own voice recording. These checks are not a substitute for a full recipient review of the cut.

## Limits

The body transport rejects oversized streamed payloads with 413 after draining up to 16 MiB. Larger streams can lose the connection instead of returning 413. Memory is bounded and no state changes.

No outreach or application was sent as part of this release. The walkthrough is a review cut. Earlier source-only deployment/video notes describe the pre-release state; this record supersedes those publication claims.
