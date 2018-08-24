define([
	'fetch/entryUtils',
], (
	entryUtils,
) => {
	'use strict';

	// This is the core runner for your game.
	// One GameManager will be created for each game (no need to clean up state)
	// It will run inside a sandboxed web worker, so you don't need to worry
	// about breaking up long-running calculations.
	// You may get some requests to change the game configuration and entries
	// (updateConfig and updateEntry). You can allow as much or as little
	// changing as you like, but it's generally better for debugging if as
	// much as possible is editable (e.g. it makes sense to allow changing the
	// maximum frame on-the-fly, but probably doesn't make sense to allow
	// changing the grid size. Also it makes sense to allow updating an existing
	// competitor, but probably doesn't make sense to add a new competitor)

	return class GameManager {
		constructor(random, gameConfig) {
			this.gameConfig = gameConfig;
			this.random = random; // a seeded random object you can use
			this.teams = gameConfig.teams;
      this.boardSize = this.teams.length * 3;
			this.board = new Array(this.boardSize).fill(0).map(c=>new Uint8Array(this.boardSize));
			this.frame = 1;
			this.simulationTime = 0;
			var presets = [[230, 25, 75],[60, 180, 75],[255, 225, 25],[0, 130, 200],[245, 130, 48],[145, 30, 180],[70, 240, 240],[240, 50, 230],[210, 245, 60],[250, 190, 190],[0, 128, 128],[230, 190, 255],[170, 110, 40],[128, 0, 0],[170, 255, 195],[128, 128, 0],[255, 215, 180],[0, 0, 256],[128, 128, 128]];
			presets = presets.map(col => col.map(c => Math.floor(255 - ((255-c)*.8))))
			this.playerColors = presets.concat(this.teams.map(c=>new Array(3).fill(0).map(c=>random.next(120)+100))).slice(0, this.teams.length);
			this.playerColors.unshift([255,255,255]);
			// gameConfig contains:
			// - seed: the current game seed. Typically you won't need to check
			//         this because the random object is pre-seeded
			// - teams: the list of teams competing in this game. Each entry
			//          also contains an 'entries' list (in free-for-all games,
			//          each team will have exactly 1 entry)
			
			this.entryLookup = new Map();
			var colors = new Array(this.teams.length).fill(0).map((_,i)=>i+1);
			for (let c of this.teams) {
				let playerEntry = c.entries[0];
				let col = colors.splice(random.next(colors.length),1)[0];
				let x, y;
				do {
					x = random.next(this.boardSize);
					y = random.next(this.boardSize);
				} while ([...this.entryLookup.entries()].some(([key, e])=>e.x == x && e.y == y));
				this.board[x][y] = col;
				let entry = {
					x,
					y,
					col,
					entryID: playerEntry.id,
					teamID: c.id,
					localStorage: {},
					thisObject: {},
					elapsedTime: 0,
					disqualified: false,
					codeSteps: 0,
					title: playerEntry.title,
				}
				entry.localStorage.setItem = (a,b)=>entry.localStorage[a] = b;
				entry.localStorage.getItem = (a)=>entry.localStorage[a]||null;
				this.entryLookup.set(playerEntry.id, entry);
				c.rgb = '#'+this.playerColors[col].map(c=>c.toString(16).padStart(2,0)).join('');
				this.updateEntry({id: playerEntry.id, code: playerEntry.code, pauseOnError: playerEntry.pauseOnError, disqualified: false});
			}
			console.log("GAME START", this.entryLookup, this.teams, this);
			
			// gameConfig.width = gameConfig.height = this.boardSize;
			// console.log(this);
		}

		updateEntry({
			id,
			code = null,
			pauseOnError = null,
			disqualified = null,
			/* other props you care about */
		}) {
			const entry = this.entryLookup.get(id);
			if(!entry) {
				throw new Error('Attempt to modify entry '+id+' which was not registered in the game');
			}
			if(code !== null) {
				// These parameter names match the key values given to fn() in
				// step(type) below
				var parameters = [
					'myself', 'grid', 'bots', 'gameInfo', 'window', 'localStorage'
				];
				const compiledCode = entryUtils.compile(code, parameters, {pre: 'Math.random = extras.MathRandom;', globals: 'localStorage = null, window = null;'});
				entry.fn = compiledCode.fn;
				if(compiledCode.compileError) {
					entry.disqualified = true;
					entry.error = compiledCode.compileError;
					console.log("Compiling error: ", compiledCode);
				} else {
					// Automatically un-disqualify entries when code is updated
					entry.error = null;
					entry.disqualified = false;
				}
				entry.errorInput = null;
				entry.errorOutput = null;
			}
			if(pauseOnError !== null) {
				entry.pauseOnError = pauseOnError;
			}
			if(disqualified !== null) {
				entry.disqualified = disqualified;
			}
			// Handle any other props you care about here
		}

		updateConfig(gameConfig) {
			// Update anything which makes sense to change mid-game here
			this.gameConfig = gameConfig;
			gameConfig.playerColors = this.playerColors;
		}

		// This is an internal method; you can change the arguments to whatever
		// you need when handling errors
		handleError(entry, params, action, error) {
			console.log(entry.title + " errored:", params, action, error);
			// errorInput, errorOutput, and error are presented to the user.
			// Fill them in with something useful. For example:
			entry.errorInput = JSON.stringify(params);
			entry.errorOutput = JSON.stringify(action);
			entry.error = (
				error + ' (gave ' + entry.errorOutput +
				' for ' + entry.errorInput + ')'
			);
			this.random.rollback();
			throw 'PAUSE';
		}

		step(type) {
			const begin = performance.now();
			if (this.frame >= this.gameConfig.maxFrame) return;
			// this.board[this.random.next(this.board.length)][this.random.next(this.board.length)] = this.random.next(this.teams.length)
			this.random.save();
			var results = new Array(this.teams.length);
			var i = 0;
			var playingBots = [...this.entryLookup.values()].filter(c=>!c.disqualified).map(c => [c.col, c.x, c.y]);
			for (var [id, entry] of this.entryLookup) {
				if (entry.disqualified) {
					results[i++] = {entry, action: "nothing"};
					continue;
				}
				var grid = new Array(this.boardSize);//this.board//.map(c=>c.slice());
				for(let i=0;i<this.boardSize;i++){
					let tmp=new Uint8Array(this.boardSize);
					for(let j=0;j<this.boardSize;j++)tmp[j] = this.board[i][j];
					grid[i] = tmp;
					// grid[i] = this.board[i].slice();
				}
				// var grid = this.board.slice().map(c=>c.slice());
				var bots = playingBots.slice().map(c=>c.slice());
				var gameInfo = [this.frame, this.gameConfig.maxFrame];
				var myself = [entry.col, entry.x, entry.y];
				var localStorage = entry.localStorage;
				// const params = {
				// 	myself,
				// 	grid,
				// 	bots,
				// 	gameInfo,
				// 	window: {localStorage},
				// 	localStorage,
				// 	this: entry.thisObject,
				// };
				const params = [myself, grid, bots, gameInfo];
				params['this'] = entry.thisObject;
				let error = null;
				let action = null;
				let elapsed = 0;
				
				try {
					const begin = performance.now();
				  action = entry.fn(params, {globals: {window: {localStorage}, localStorage}, consoleTarget: {push: a => console[a.type](a.value), log: console.log}, MathRandom: ()=>this.random.nextFloat()}); //consoleTarget: entry.console   consoleTarget:console
					elapsed = performance.now() - begin;
				} catch(e) {
					error = e;
				}
				// if (this.board.some((col,x)=>col.some((c,y) => grid[x][y] != c))) console.log(entry);
				entry.elapsedTime += elapsed;
				++ entry.codeSteps;
				if (error) {
					this.handleError(entry, params, action, error);
				}
				results[i++] = {entry, action};
			}
			for (let {entry, action} of results) {
				if (entry.disqualified) continue;
				if (action == "up") {
					entry.y -= 1;
					if (entry.y < 0) entry.y = 0;
				} else if (action == "down") {
					entry.y += 1;
					if (entry.y >= this.boardSize) entry.y = this.boardSize-1;
				} else if (action == "right") {
					entry.x += 1;
					if (entry.x >= this.boardSize) entry.x = this.boardSize-1;
				} else if (action == "left") {
					entry.x -= 1;
					if (entry.x < 0) entry.x = 0;
				}

				if (this.board[entry.x][entry.y] > 0) {
					this.board[entry.x][entry.y] = [entry.col, 0, this.board[entry.x][entry.y]][Math.abs(entry.col-this.board[entry.x][entry.y])%3];
				} else {
					this.board[entry.x][entry.y] = entry.col;
				}
			}
			
			for (var [id, entry] of this.entryLookup) { // player+player = 0
				if (entry.disqualified) continue;
				for (var [id2, entry2] of this.entryLookup) { // player+player = 0
					if (!entry2.disqualified && entry != entry2 && entry.x == entry2.x && entry.y == entry2.y) {
						this.board[entry.x][entry.y] = 0;
					}
				}
			}
			
			if (this.frame>=5) { // eliminating
				var found = new Array(this.teams.length+1).fill(0);
				for (var col of this.board) for (var item of col) found[item]++;
				for (let [id, entry] of this.entryLookup) {
					if (found[entry.col] <= 1) {
						entry.disqualified=true;
					}
				}
			}
			
			this.frame++;
			this.simulationTime += performance.now() - begin;
		}

		isOver() {
			// Return false until your game is over, then true.
			return this.frame >= this.gameConfig.maxFrame;
		}

		getState() {
			// This will be used by some internal management tasks, and will be
			// given to your Display and GameScorer classes.
			return {
				// Framework data
				over: this.isOver(), // when true, the game stops

				// Game specific data
				// Put anything you like here, but make sure you have teams:
				size: this.boardSize,
				board: this.board,
				progress: this.frame / this.gameConfig.maxFrame,
				// allEntries: [...this.entryLookup.entries()].map(c=>c[1]),
				frame: this.frame,
				simulationTime: this.simulationTime,
				maxFrame: this.gameConfig.maxFrame,
				playerColors: this.playerColors,
				teams: this.teams.map((team) => ({
					id: team.id,
					rgb: team.rgb,
					entries: team.entries.map((entryState) => {
						const entry = this.entryLookup.get(entryState.id);
						return {
							id: entryState.id,
							disqualified: entry.disqualified,
							title: entryState.title,
							
							elapsedTime: entry.elapsedTime,
							codeSteps: entry.codeSteps,
							error: entryState.error,
							errorInput: entryState.errorInput,
							errorOutput: entryState.errorOutput,
							console: entryState.console,
							col: entry.col,
							x: entry.x,
							y: entry.y,
						};
					}),
				})),
			};
		}
	};
});
