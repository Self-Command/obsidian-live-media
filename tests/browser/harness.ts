import {OfflineEngine} from '../../src/engine/client';
const engine = new OfflineEngine();
Object.assign(window, {liveMediaHarness: {engine}});
