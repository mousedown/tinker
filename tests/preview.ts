import { reduce, initialState } from '../tui/state';
import { screen } from '../tui/view';
import { NOW, ROWS } from './fixtures';

const [w, h, view] = [Number(process.argv[2] ?? 110), Number(process.argv[3] ?? 30), process.argv[4]];
let state = reduce(initialState(w, h), { type: 'rows', rows: ROWS, now: NOW }).state;
if (view === 'detail') state = reduce(state, { type: 'key', key: { name: 'enter' } }).state;
process.stdout.write(screen(state).join('\n') + '\n');
