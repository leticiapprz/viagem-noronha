// =============================================
// COLE ESTE CÓDIGO NO GOOGLE APPS SCRIPT
// (Extensões → Apps Script na planilha)
// Versão 2 — tabelas estruturadas
// =============================================

function getOrCreateSheet(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  return sheet;
}

function doGet() {
  var gastos = getOrCreateSheet('Gastos', ['ID', 'Categoria', 'Item', 'Previsto', 'Gasto Real', 'Quem Pagou', 'Deve Alguém', 'Pago?']);
  var diadia = getOrCreateSheet('Dia a Dia', ['Dia', 'Data', 'Gasto do Dia']);
  var checklist = getOrCreateSheet('Checklist', ['Item', 'Marcado']);

  var lista = getOrCreateSheet('Lista', ['Item', 'Comprado?']);

  var result = { gastos: [], diadia: [], checklist: [], lista: [] };

  var gData = gastos.getDataRange().getValues();
  for (var i = 1; i < gData.length; i++) {
    result.gastos.push({
      id: gData[i][0],
      categoria: gData[i][1],
      item: gData[i][2],
      previsto: gData[i][3],
      gastoReal: gData[i][4],
      quemPagou: gData[i][5],
      deveAlguem: gData[i][6],
      pago: gData[i][7]
    });
  }

  var dData = diadia.getDataRange().getValues();
  for (var i = 1; i < dData.length; i++) {
    result.diadia.push({
      dia: dData[i][0],
      data: dData[i][1],
      gasto: dData[i][2]
    });
  }

  var cData = checklist.getDataRange().getValues();
  for (var i = 1; i < cData.length; i++) {
    result.checklist.push({
      item: cData[i][0],
      marcado: cData[i][1]
    });
  }

  var lData = lista.getDataRange().getValues();
  for (var i = 1; i < lData.length; i++) {
    result.lista.push({ item: lData[i][0], checked: lData[i][1] });
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var payload = JSON.parse(e.postData.contents);
  var action = payload.action;

  if (action === 'init') {
    var gastos = getOrCreateSheet('Gastos', ['ID', 'Categoria', 'Item', 'Previsto', 'Gasto Real', 'Quem Pagou', 'Deve Alguém', 'Pago?']);
    var diadia = getOrCreateSheet('Dia a Dia', ['Dia', 'Data', 'Gasto do Dia']);
    var checklist = getOrCreateSheet('Checklist', ['Item', 'Marcado']);

    // Limpa e repopula
    if (gastos.getLastRow() > 1) gastos.getRange(2, 1, gastos.getLastRow() - 1, 8).clearContent();
    if (diadia.getLastRow() > 1) diadia.getRange(2, 1, diadia.getLastRow() - 1, 3).clearContent();
    if (checklist.getLastRow() > 1) checklist.getRange(2, 1, checklist.getLastRow() - 1, 2).clearContent();

    var gRows = payload.gastos;
    for (var i = 0; i < gRows.length; i++) {
      var g = gRows[i];
      gastos.appendRow([g.id, g.categoria, g.item, g.previsto, g.gastoReal || '', g.quemPagou || '', g.deveAlguem || '', g.pago || 'Não']);
    }

    var dRows = payload.diadia;
    for (var i = 0; i < dRows.length; i++) {
      var d = dRows[i];
      diadia.appendRow([d.dia, d.data, d.gasto || '']);
    }

    var cRows = payload.checklist;
    for (var i = 0; i < cRows.length; i++) {
      var c = cRows[i];
      checklist.appendRow([c.item, c.marcado || false]);
    }

    return ContentService.createTextOutput(JSON.stringify({ok: true}))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'update-gasto') {
    var gastos = getOrCreateSheet('Gastos', ['ID', 'Categoria', 'Item', 'Previsto', 'Gasto Real', 'Quem Pagou', 'Deve Alguém', 'Pago?']);
    var data = gastos.getDataRange().getValues();
    var colMap = { gastoReal: 5, quemPagou: 6, deveAlguem: 7, pago: 8 };
    var col = colMap[payload.field];
    if (!col) return ContentService.createTextOutput(JSON.stringify({error: 'campo inválido'}));
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === payload.id) {
        gastos.getRange(i + 1, col).setValue(payload.value);
        break;
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ok: true}))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'update-diadia') {
    var diadia = getOrCreateSheet('Dia a Dia', ['Dia', 'Data', 'Gasto do Dia']);
    var data = diadia.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(payload.dia)) {
        diadia.getRange(i + 1, 3).setValue(payload.gasto);
        break;
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ok: true}))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'update-checklist') {
    var checklist = getOrCreateSheet('Checklist', ['Item', 'Marcado']);
    var data = checklist.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === payload.item) {
        checklist.getRange(i + 1, 2).setValue(payload.marcado);
        break;
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ok: true}))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'update-lista') {
    var lista = getOrCreateSheet('Lista', ['Item', 'Comprado?']);
    if (lista.getLastRow() > 1) lista.getRange(2, 1, lista.getLastRow() - 1, 2).clearContent();
    var items = payload.items;
    for (var i = 0; i < items.length; i++) {
      lista.appendRow([items[i].text, items[i].checked ? 'Sim' : 'Não']);
    }
    return ContentService.createTextOutput(JSON.stringify({ok: true})).setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify({error: 'ação desconhecida'}))
    .setMimeType(ContentService.MimeType.JSON);
}
