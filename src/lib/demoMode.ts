/** The demo build (VITE_DEMO=1): sample data loaded at start, nothing imported, exported or stored. */
export const DEMO = import.meta.env.VITE_DEMO === '1';
export const DEMO_BLOCKED = 'This is a demo: importing, exporting and clearing data are turned off.';
