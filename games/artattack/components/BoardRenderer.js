define([
	'display/documentUtils'
], (
	docutil
) => {
	'use strict';


	const UNKNOWN_ENTRY = {
		entry: {id: '', title: 'Unknown'},
		team: {id: ''},
	};



	return class BoardRenderer {
		constructor() {
			this.size = 0;
			this.canvas = docutil.make('canvas');
			this.canvas.width = 0;
			this.canvas.height = 0;
			this.markerDiv = docutil.make('div', {}, []);
			docutil.updateStyle(this.markerDiv, {
				'position': 'absolute',
			});
			this.board = docutil.make('div', {}, [this.markerDiv, this.canvas]);
			this.context = this.canvas.getContext('2d');
			this.dat = null;
			this.renderedMarks = new Map();
			this.entries = new Map();
		}





		setSize(size) {
			if(this.size !== size) {
				this.dat = new ImageData(size, size);
				this.size = size;
				this.width = size;
				this.height = size;
				this.canvas.width = size;
				this.canvas.height = size;
				this.repaint();
				this.setScale(500/size);
			}
		}

		setScale(scale) {
			if(this.scale !== scale) {
				this.scale = scale;
				this.rerender();
			}
		}
		
		getSize() {
			return {width: this.size, height: this.size};
		}


		clear() {
			this.repaint();
		}

		updateGameConfig({teams}) {
			// this.size = size;
			this.entries.clear();
			teams.forEach((team) => team.entries.forEach((entry) => {
				this.entries.set(entry.id, {team, entry});
			}));
			this.rerender();
		}

		updateState({board, teams, size, playerColors}) {
			this.setSize(size);
			this.playerColors = playerColors;
			this.rawBoard = board;
			this.rawPlayers = teams;

			if(!this.dat) {
				return;
			}

			const begin = performance.now();
			this.repaint();
			this.renderTime += performance.now() - begin;
			++ this.renderCount;
		}

		repaint() {
			if(!this.dat || !this.playerColors) {
				return;
			}
			if (this.rawBoard.length != this.size) return;
			if(!this.rawBoard) {
				this.dat.data.fill(0);
			} else {
				const d = this.dat.data;
				for(let y = 0; y < this.size; ++ y) {
					for(let x = 0; x < this.size; ++ x) {
						const cell = this.rawBoard[x][y];
						const c = this.playerColors[cell];
						const l = (y * this.width + x) * 4;
						d[l    ] = c[0];
						d[l + 1] = c[1];
						d[l + 2] = c[2];
						d[l + 3] = 255;
					}
				}
			}
			this.context.putImageData(this.dat, 0, 0);
			this.rerender();
		}

		populateMarkers(markers) {
			
			this.rawPlayers.forEach((team) => {
				let entry = team.entries[0];
				const x = entry.x;
				const y = entry.y;
				let className = 'team team-' + team.id;
				let tooltip = entry.title+': color ' + entry.col;
				markers.set(team.id, {
					x,
					y,
					className,
					tooltip,
				});
			});
		}
		
		
		rerender() {
			docutil.updateStyle(this.canvas, {
				'width':  Math.round(this.size * this.scale) + 'px',
				'height': Math.round(this.size * this.scale) + 'px',
			});
			docutil.updateStyle(this.board, {
				'width':  Math.round(this.size * this.scale) + 'px',
				'height': Math.round(this.size * this.scale) + 'px',
				'margin': '0 auto',
				'display': 'inline-block',
				// 'position': 'absolute',
			});

			const markers = new Map();

			if(this.rawBoard && this.rawPlayers) {
				this.populateMarkers(markers);
			}

			markers.forEach((mark, key) => {
				let dom = this.renderedMarks.get(key);
				if(!dom) {
					dom = {
						element: docutil.make('div'),
					};
					this.renderedMarks.set(key, dom);
				}
				docutil.updateAttrs(dom.element, {
					'class': 'mark ' + (mark.className || ''),
					'title': mark.tooltip,
				});
				docutil.updateStyle(dom.element, {
					'left': (mark.x * this.scale) + 'px',
					'top': (mark.y * this.scale) + 'px',
					'width': this.scale + 'px',
					'height': this.scale + 'px',
					'fontSize': this.scale + 'px',
				});
				docutil.setParent(dom.element, this.markerDiv);
			});

			this.renderedMarks.forEach((dom, key) => {
				if(!markers.has(key)) {
					docutil.setParent(dom.element, null);
					this.renderedMarks.delete(key);
				}
			});
		}

		dom() {
			return this.board;
		}
	};
});
