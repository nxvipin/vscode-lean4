
import * as assert from 'assert';
import { basename } from 'path';
import * as vscode from 'vscode';
import { InfoProvider } from '../../../src/infoview';
import { LeanClient} from '../../../src/leanclient';

export function sleep(ms : number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function closeAllEditors(): Thenable<any> {
	return vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

export async function initLean4(fileName: string) : Promise<vscode.Extension<any>>{

    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    const options : vscode.TextDocumentShowOptions = { preview: false };

    const doc = await vscode.workspace.openTextDocument(fileName);
    await vscode.window.showTextDocument(doc, options);

    const lean = await waitForActiveExtension('leanprover.lean4');
    assert(lean, 'Lean extension not loaded');
    assert(lean.exports.isLean4Project);
    assert(lean.isActive);
    console.log(`Found lean package version: ${lean.packageJSON.version}`);
    await waitForActiveEditor(basename(fileName));

    const info = lean.exports.infoProvider as InfoProvider;
    assert(await waitForInfoViewOpen(info, 60),
        'Info view did not open after 20 seconds');
    return lean;
}

export async function initLean4Untitled(contents: string) : Promise<vscode.Extension<any>>{
    // make sure test is always run in predictable state, which is no file or folder open
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');

    await vscode.commands.executeCommand('workbench.action.files.newUntitledFile');

    const editor = await waitForActiveEditor();
    // make it a lean4 document even though it is empty and untitled.
    console.log('Setting lean4 language on untitled doc');
    await vscode.languages.setTextDocumentLanguage(editor.document, 'lean4');

    await editor.edit((builder) => {
        builder.insert(new vscode.Position(0, 0), contents);
    });

    const lean = await waitForActiveExtension('leanprover.lean4');
    assert(lean, 'Lean extension not loaded');

    console.log(`Found lean package version: ${lean.packageJSON.version}`);
    const info = lean.exports.infoProvider as InfoProvider;

    // If info view opens too quickly there is no LeanClient ready yet and
    // it's initialization gets messed up.
    assert(await waitForInfoViewOpen(info, 60),
        'Info view did not open after 60 seconds');
    return lean;
}

export async function resetToolchain() : Promise<void>{
    await vscode.commands.executeCommand('lean4.selectToolchain', 'reset');
}

export async function waitForActiveExtension(extensionId: string, retries=10, delay=1000) : Promise<vscode.Extension<any> | null> {

    console.log(`Waiting for extension ${extensionId} to be loaded...`);
    let lean : vscode.Extension<any> | undefined;
    let count = 0;
    while (!lean) {
        vscode.extensions.all.forEach((e) => {
            if (e.id === extensionId){
                lean = e;
                console.log(`Found extension: ${extensionId}`);
            }
        });
        if (!lean){
            count += 1;
            if (count >= retries){
                return null;
            }
            await sleep(delay);
        }
    }

    console.log(`Waiting for extension ${extensionId} activation...`);
    count = 0
    while (!lean.isActive && count < retries){
        await sleep(delay);
        count += 1;
    }

    console.log(`Extension ${extensionId} isActive=${lean.isActive}`);
    return lean;
}

export async function waitForActiveEditor(filename='', retries=10, delay=1000) : Promise<vscode.TextEditor> {
    let count = 0;
    while (!vscode.window.activeTextEditor && count < retries){
        await sleep(delay);
        count += 1;
    }
    const editor = vscode.window.activeTextEditor
    assert(editor, 'Missing active text editor');

    console.log(`Loaded document ${editor.document.uri}`);

    if (filename) {
        count = 0;
        while (!editor.document.uri.fsPath.endsWith(filename) && count < retries){
            await sleep(delay);
            count += 1;
        }
        assert(editor.document.uri.fsPath.endsWith(filename), `Active text editor does not match ${filename}`);
    }

    return editor;
}

export async function waitForInfoViewOpen(infoView: InfoProvider, retries=10, delay=1000) : Promise<boolean> {
    let count = 0;
    let opened = false;
    console.log('Waiting for InfoView...');
    while (count < retries){
        const isOpen = infoView.isOpen();
        if (isOpen) {
            console.log('InfoView is open.');
            return true;
        } else if (!opened) {
            opened = true;
            await vscode.commands.executeCommand('lean4.displayGoal');
        }
        await sleep(delay);
        count += 1;
    }

    console.log('InfoView not found.');
    return false;
}

export async function waitForHtmlString(infoView: InfoProvider, toFind : string, retries=10, delay=1000): Promise<string> {
    let count = 0;
    let html = '';
    while (count < retries){
        html = await infoView.getHtmlContents();
        if (html.indexOf(toFind) > 0){
            return html;
        }
        if (html.indexOf('<details>')) { // we want '<details open>' instead...
            await infoView.toggleAllMessages();
        }
        await sleep(delay);
        count += 1;
    }

    console.log('>>> infoview contents:')
    console.log(html);
    assert(false, `Missing "${toFind}" in infoview`);
    return html;
}

export function extractPhrase(html: string, word: string, terminator: string){
    const pos = html.indexOf(word);
    if (pos >= 0){
        let endPos = html.indexOf(terminator, pos);
        if (endPos < 0) {
            endPos = html.indexOf('\n', pos);
            return ''
        }
        return html.substring(pos, endPos);
    }
    return '';
}

export async function findWord(editor: vscode.TextEditor, word: string, retries = 10, delay = 1000) : Promise<vscode.Range> {
    let count = 0;
    while (retries > 0) {
            const text = editor.document.getText();
        const pos = text.indexOf(word);
        if (pos < 0) {
            await sleep(delay);
            count += 1;
        } else {
            return new vscode.Range(editor.document.positionAt(pos), editor.document.positionAt(pos + word.length));
        }
    }

    assert(false, `word ${word} not found in editor`);
}

export async function gotoDefinition(editor: vscode.TextEditor, word: string, retries = 10, delay = 1000) : Promise<void> {
    const wordRange = await findWord(editor, word, retries, delay);

    // The -1 is to workaround a bug in goto definition.
    // The cursor must be placed before the end of the identifier.
    const secondLastChar = new vscode.Position(wordRange.end.line, wordRange.end.character - 1);
    editor.selection = new vscode.Selection(wordRange.start, secondLastChar);

    await vscode.commands.executeCommand('editor.action.revealDefinition');
}

export async function restartLeanServer(client: LeanClient, retries=10, delay=1000) : Promise<boolean> {
    let count = 0;
    console.log('restarting lean client ...');

    const stateChanges : string[] = []
    client.stopped(() => { stateChanges.push('stopped'); });
    client.restarted(() => { stateChanges.push('restarted'); });
    client.serverFailed(() => { stateChanges.push('failed'); });

    await vscode.commands.executeCommand('lean4.restartServer');

    while (count < retries){
        const index = stateChanges.indexOf('restarted');
        if (index > 0) {
            break;
        }
        await sleep(delay);
        count += 1;
    }

    // check we have no errors.
    const actual = stateChanges.toString();
    assert(actual === 'stopped,restarted');
    return false;
}

export async function assertStringInInfoview(infoView: InfoProvider, expectedVersion: string) : Promise<string> {
    const html = await waitForHtmlString(infoView, expectedVersion);
    const pos = html.indexOf(expectedVersion);
    if (pos >= 0) {
        // e.g. 4.0.0-nightly-2022-02-16
        const versionString = html.substring(pos, pos + 24)
        console.log(`>>> Found default "${versionString}" in infoview`)
    }
    return html;
}
