/**
 * GameOver.js — displayed when the player's HP reaches 0.
 *
 * Receives scene data: { turns: number }
 */

export class GameOver extends Phaser.Scene {

    constructor() { super('GameOver'); }

    create(data) {
        const turns = data?.turns ?? 0;

        this.add.rectangle(640, 360, 1280, 720, 0x05050f);

        this.add.text(640, 240, 'GAME OVER', {
            fontSize  : '72px',
            color     : '#cc3333',
            fontStyle : 'bold',
        }).setOrigin(0.5);

        this.add.text(640, 340, `You survived ${turns} turn${turns !== 1 ? 's' : ''}.`, {
            fontSize : '28px',
            color    : '#aaaacc',
        }).setOrigin(0.5);

        const btn = this.add.text(640, 450, '  Play Again  ', {
            fontSize        : '28px',
            color           : '#ffffff',
            backgroundColor : '#1a4a1a',
            padding         : { x: 20, y: 12 },
        }).setOrigin(0.5).setInteractive();
        btn.input.cursor = 'pointer';

        btn.on('pointerdown', () => this.scene.start('Game'));
        btn.on('pointerover', () => btn.setStyle({ color: '#aaffaa' }));
        btn.on('pointerout',  () => btn.setStyle({ color: '#ffffff' }));

        const menuBtn = this.add.text(640, 530, 'Main Menu', {
            fontSize : '20px',
            color    : '#778899',
        }).setOrigin(0.5).setInteractive();
        menuBtn.input.cursor = 'pointer';

        menuBtn.on('pointerdown', () => this.scene.start('Start'));
        menuBtn.on('pointerover', () => menuBtn.setStyle({ color: '#aabbcc' }));
        menuBtn.on('pointerout',  () => menuBtn.setStyle({ color: '#778899' }));
    }
}
