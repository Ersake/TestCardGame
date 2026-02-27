/**
 * Start.js — Title screen. Launches the Game scene.
 */

export class Start extends Phaser.Scene {

    constructor() {
        super('Start');
    }

    create() {
        this.add.rectangle(640, 360, 1280, 720, 0x05050f);

        this.add.text(640, 220, 'TestCardGame', {
            fontSize  : '72px',
            color     : '#ffffff',
            fontStyle : 'bold',
        }).setOrigin(0.5);

        this.add.text(640, 320, 'A turn-based card game', {
            fontSize : '26px',
            color    : '#7788bb',
        }).setOrigin(0.5);

        const startBtn = this.add.text(640, 400, '  Solo Play  ', {
            fontSize        : '32px',
            color           : '#ffffff',
            backgroundColor : '#1a4a1a',
            padding         : { x: 20, y: 14 },
        }).setOrigin(0.5).setInteractive();
        startBtn.input.cursor = 'pointer';

        startBtn.on('pointerdown', () => this.scene.start('Game', { mode: 'solo' }));
        startBtn.on('pointerover', () => startBtn.setStyle({ color: '#aaffaa' }));
        startBtn.on('pointerout',  () => startBtn.setStyle({ color: '#ffffff' }));

        const multiBtn = this.add.text(640, 480, '  Multiplayer  ', {
            fontSize        : '32px',
            color           : '#ffffff',
            backgroundColor : '#1a1a4a',
            padding         : { x: 20, y: 14 },
        }).setOrigin(0.5).setInteractive();
        multiBtn.input.cursor = 'pointer';

        multiBtn.on('pointerdown', () => this.scene.start('Lobby'));
        multiBtn.on('pointerover', () => multiBtn.setStyle({ color: '#aaaaff' }));
        multiBtn.on('pointerout',  () => multiBtn.setStyle({ color: '#ffffff' }));

        this.add.text(640, 680, 'Play cards · Defeat enemies · Survive', {
            fontSize : '16px',
            color    : '#445566',
        }).setOrigin(0.5);
    }
}
