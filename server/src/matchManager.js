import { GameEngine } from "./gameEngine.js";

export const DEFAULT_STATION_COUNT = 2;

// Holds one fully independent GameEngine per booth "station" (one physical TV each).
// Stations share nothing at runtime: separate players, timers, scores and matchCode.
// The engine itself is unchanged, this only owns the set of them and routes to the right one.
//
// A station id is a stable number (1, 2, ...) because a TV's URL (/screen/1) must not change
// between matches. The matchCode inside each engine still regenerates after every match.
export class MatchManager {
  // onChange(stationId, snapshot) fires for every state change of any station's engine.
  constructor(questions, onChange = () => {}, config = {}, stationCount = DEFAULT_STATION_COUNT) {
    this.stations = new Map();
    for (let stationId = 1; stationId <= stationCount; stationId++) {
      const engine = new GameEngine(questions, (snapshot) => onChange(stationId, snapshot), config);
      this.stations.set(stationId, engine);
    }
  }

  get stationIds() {
    return [...this.stations.keys()];
  }

  // Accepts a number or a numeric string (it will usually come from a URL). Returns null
  // for anything that isn't a real station, never throws on untrusted input.
  getEngine(stationId) {
    return this.stations.get(Number(stationId)) ?? null;
  }

  // The code a phone got from a QR decides which station it joins. Returns
  // { stationId, engine } or null if no station is currently issuing that code
  // (a stale QR from a finished match matches nothing).
  findByCode(code) {
    if (typeof code !== "string" || !code) return null;
    for (const [stationId, engine] of this.stations) {
      if (engine.matchCode === code) return { stationId, engine };
    }
    return null;
  }

  getSnapshot(stationId) {
    return this.getEngine(stationId)?.getSnapshot() ?? null;
  }

  // Admin edits to the question bank / config apply to every station.
  setQuestions(questions) {
    this.stations.forEach((engine) => engine.setQuestions(questions));
  }

  updateConfig(partial) {
    this.stations.forEach((engine) => engine.updateConfig(partial));
  }

  // All stations share one config, so any engine's copy is representative.
  get config() {
    return this.stations.get(1).config;
  }
}
