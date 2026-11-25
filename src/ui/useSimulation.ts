/**
 * React glue around the (mutable, deterministic) TarmacSimulation.
 *
 * Playback speed only changes how fast minutes tick by on screen — never the
 * results — so a demo replays identically at any speed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  TarmacSimulation,
  compareRuns,
  demoScenario,
  generateClinicDay,
  runBaseline,
  withConfig,
  type ClinicDay,
  type Command,
  type MetricsComparison,
  type RunResult,
  type ScheduledCommand,
  type TarmacConfig,
} from '../engine';

export type Mode = 'DEMO' | 'RANDOM';

interface Setup {
  id: number;
  mode: Mode;
  seed: number;
  day: ClinicDay;
  config: TarmacConfig;
  scripted: ScheduledCommand[];
}

function makeSetup(id: number, mode: Mode, seed: number): Setup {
  if (mode === 'DEMO') {
    const d = demoScenario();
    return { id, mode, seed: d.config.seed, day: d.day, config: d.config, scripted: d.commands };
  }
  return { id, mode, seed, day: generateClinicDay(seed), config: withConfig({ seed }), scripted: [] };
}

export const SPEEDS = [1, 3, 6, 12, 30] as const;

export function useSimulation() {
  const [setup, setSetup] = useState<Setup>(() => makeSetup(0, 'DEMO', 42));
  const simRef = useRef<TarmacSimulation>(new TarmacSimulation(setup.day, setup.config, setup.scripted));
  const [version, setVersion] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(6);
  const [userCommands, setUserCommands] = useState<ScheduledCommand[]>([]);
  const finishListeners = useRef<(() => void)[]>([]);

  const bump = () => setVersion((v) => v + 1);

  const reset = useCallback((mode: Mode, seed: number) => {
    const s = makeSetup(Date.now(), mode, seed);
    simRef.current = new TarmacSimulation(s.day, s.config, s.scripted);
    setSetup(s);
    setUserCommands([]);
    setPlaying(false);
    bump();
  }, []);

  const step = useCallback((minutes = 1) => {
    const sim = simRef.current;
    for (let i = 0; i < minutes && !sim.finished; i++) sim.step();
    bump();
  }, []);

  const stepTo = useCallback((t: number) => {
    const sim = simRef.current;
    while (sim.t < t && !sim.finished) sim.step();
    bump();
  }, []);

  const runToEnd = useCallback(() => {
    const sim = simRef.current;
    while (!sim.finished) sim.step();
    setPlaying(false);
    bump();
  }, []);

  /** Clinic / patient action, recorded so the baseline can replay it too. */
  const act = useCallback((command: Command) => {
    const sim = simRef.current;
    if (sim.finished) return;
    sim.apply(command);
    setUserCommands((c) => [...c, { at: sim.t, command }]);
    bump();
  }, []);

  // Playback loop
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const loop = (now: number) => {
      acc += ((now - last) / 1000) * speed;
      last = now;
      const sim = simRef.current;
      let n = Math.floor(acc);
      acc -= n;
      if (n > 0) {
        n = Math.min(n, 60);
        for (let i = 0; i < n && !sim.finished; i++) sim.step();
        bump();
      }
      if (sim.finished) {
        setPlaying(false);
        finishListeners.current.forEach((f) => f());
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]);

  const sim = simRef.current;
  const allCommands = useMemo(() => [...setup.scripted, ...userCommands], [setup, userCommands]);

  // Baseline over the identical patient stream + the same clinic events.
  const baseline: RunResult = useMemo(() => runBaseline(setup.day, setup.config, allCommands), [setup, allCommands]);

  const comparison: MetricsComparison | null = useMemo(
    () => (sim.finished ? compareRuns(setup.seed, baseline, sim.result()) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sim.finished, baseline, version],
  );

  const onFinish = useCallback((f: () => void) => {
    finishListeners.current.push(f);
    return () => {
      finishListeners.current = finishListeners.current.filter((x) => x !== f);
    };
  }, []);

  return {
    sim,
    version,
    setup,
    playing,
    setPlaying,
    speed,
    setSpeed,
    reset,
    step,
    stepTo,
    runToEnd,
    act,
    baseline,
    comparison,
    userCommands,
    onFinish,
  };
}

export type SimApi = ReturnType<typeof useSimulation>;
