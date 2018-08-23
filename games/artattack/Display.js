define([
	'core/EventObject',
	'display/documentUtils',
	'display/Full2DBoard',
	'games/artattack/components/BoardRenderer',
	'games/common/BaseDisplay',
	'games/common/components/StepperOptions',
	'display/OptionsBar',
	'games/artattack/GameScorer',
	'games/common/components/LeaderboardDisplay',
	'./style.css',
	// You can also include stylesheets if you want to (e.g. ./style.css)
], (
	EventObject,
	docutil,
	Full2DBoard,
	BoardRenderer,
	BaseDisplay,
	StepperOptions,
	OptionsBar,
	GameScorer,
	LeaderboardDisplay,
) => {
	'use strict';

	// This code runs on the main UI thread outside the sandbox. It should not
	// run any untrusted code, and should be fast! It is responsible for
	// rendering the game-specific UI (e.g. game visualisation, results table,
	// options bar)

	return class Display extends BaseDisplay {
		constructor(mode) {
			super(mode);
			// Make any DOM objects you want here, or delegate to convenient
			// display objects (see the other games for examples)

			// docutil is a collection of convenience wrappers around DOM calls
			// such as createElement, appendChild, etc. This call will create
			// a <section> element with class="game-container" and a text node
			// child saying "Hello!":
			// (you can create DOM nodes using any methods/libraries you like)

			const renderer = new BoardRenderer();
			const options = new StepperOptions(StepperOptions.makeSpeedButtons({
				'-3': {delay: 1000, speed: 1},
				'-2': {delay: 500, speed: 1},
				'-1': {delay: 250, speed: 1},
				'0': {delay: 0, speed: 1},
				'1': {delay: 0, speed: 10},
				'2': {delay: 0, speed: 50},
				'3': {delay: 0, speed: 500},
			}));
			
			const table = new LeaderboardDisplay({
				columns: [],
				GameScorer,
			});
			console.log(table);
			this.leaderboard = table;
			this.board = new Full2DBoard({
				renderer
			});
			// options.setRenderPerformance(renderer);

			options.addEventForwarding(this);
			this.addVisualisationChild(options, {screensaver: false});
			// this.addVisualisationChild(this.board);
			this.addChild(renderer);
			var desc = docutil.make(
				'section',
				{'class': 'game-container','style': 'display:inline-block; font-size:10px'},
				[renderer.dom(),docutil.make('br'),'shortcuts: backtick: step; 1-5: different speeds; space: pause']
			)
			this.addChild({dom:()=>docutil.make('br')});
			this.addChild({dom:()=>desc});
			this.addChild(table);

			// If you want to allow your user to change play/game/display
			// configurations, provide UI elements here and call:

			// this.trigger('changeplay', [{foo: 'bar'}]);
			// this.trigger('changegame', [{foo: 'bar'}]);
			// this.trigger('changedisplay', [{foo: 'bar'}]);

			// (those examples will set the "foo" configuration property to
			// "bar" in each of play config, game config, and display config)
			// Whenever you trigger a changeX event, the corresponding
			// updateXConfig method (below) will be called with the updated
			// configuration.

			// You may also want to trigger step-by-step progression of your
			// game:
			// this.trigger('step', ['customName', stepsToAdvance]);
			// (customName should tie to something you have defined in
			// GameManager.step, and is '' by default. stepsToAdvance should
			// be a number showing how many times to call the step function
			// before returning a state for rendering)
		}

		clear() {
			super.clear();
			this.board.repaint();
			// Reset all displayed data; a new game is about to begin
		}

		// These will be called with the latest configuration objects.
		// This could be at the start of a new game, on history navigation, or
		// when your own code triggers a 'changeX'. You should update any
		// relevant UI, including configuration input UI

		updatePlayConfig(config) {
			super.updatePlayConfig(config);
		}

		updateGameConfig(config) {
			super.updateGameConfig(config);
			this.board.repaint();
		}

		updateDisplayConfig(config) {
			// config is initially from <meta name="display-config" ...>
		}

		updateState(state) {
			super.updateState(state);
			this.board.repaint();
			this.leaderboard.updateTeams(state.teams);
			
			// This is called periodically during the game simulation.
			// It should re-render any relevant components as quickly as
			// possible (game logic is on another thread, but time spent here
			// will impact the page's responsiveness)

			// state is from GameManager.getState
		}

		dom() {
			// Return your root component here
			return super.dom();
		}
	};
});
