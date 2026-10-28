// The plugin calls window.setTimeout, as Obsidian asks for popout windows; Node's timers stand in.
Object.assign(globalThis, { window: globalThis });
