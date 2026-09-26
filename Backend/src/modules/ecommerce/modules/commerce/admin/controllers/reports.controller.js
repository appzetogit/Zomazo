import ExcelJS from 'exceljs';
import { sendResponse } from '../../../../utils/response.js';
import * as reports from '../services/reports.service.js';

const fmtDate = (d) => (d ? new Date(d).toISOString() : '');
const day = (d) => new Date(d).toISOString().slice(0, 10);

function addSheet(wb, name, columns, rows) {
    const ws = wb.addWorksheet(name);
    ws.columns = columns.map(([header, key, width = 16]) => ({ header, key, width }));
    ws.getRow(1).font = { bold: true };
    for (const r of rows) ws.addRow(r);
    return ws;
}

async function sendWorkbook(res, wb, filename) {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
}

function slaWorkbook(r) {
    const wb = new ExcelJS.Workbook();
    const stats = [
        ['Orders', 'count', 10], ['Unit', 'unit', 10], ['Median', 'median', 10], ['P90', 'p90', 10],
        ['Judged', 'judged', 10], ['On time', 'onTime', 10], ['Late', 'late', 10], ['On time %', 'onTimePct', 12],
    ];
    addSheet(wb, 'By mode', [['Mode', 'fulfilmentMode', 12], ...stats], r.byMode);
    addSheet(wb, 'By seller', [['Seller', 'sellerName', 28], ['Seller ID', 'sellerId', 26], ['Mode', 'fulfilmentMode', 12], ...stats], r.bySeller);
    addSheet(
        wb,
        'Late orders',
        [['Order', 'order_id', 18], ['Seller', 'sellerName', 28], ['Mode', 'fulfilmentMode', 12], ['Placed', 'placedAt', 24],
            ['Delivered', 'deliveredAt', 24], ['Duration', 'duration', 10], ['Unit', 'unit', 10], ['Promised', 'promised', 24]],
        r.lateOrders.map((o) => ({ ...o, placedAt: fmtDate(o.placedAt), deliveredAt: fmtDate(o.deliveredAt), promised: o.promised instanceof Date ? fmtDate(o.promised) : o.promised }))
    );
    return wb;
}

function commissionWorkbook(r) {
    const wb = new ExcelJS.Workbook();
    addSheet(
        wb,
        'Commission',
        [['Seller', 'sellerName', 28], ['Seller ID', 'sellerId', 26], ['Orders', 'orders', 10], ['Gross item value', 'grossItemValue'],
            ['Commission', 'commission'], ['Commission %', 'commissionPct', 12], ['Seller-funded discount', 'sellerFundedDiscount', 22],
            ['Platform-funded discount', 'platformFundedDiscount', 24], ['Coins discount', 'coinsDiscount'], ['Net payable', 'netPayable']],
        [...r.sellers, { ...r.totals, sellerId: '' }]
    ).lastRow.font = { bold: true };
    return wb;
}

function coinWorkbook(r) {
    const wb = new ExcelJS.Workbook();
    addSheet(
        wb,
        'By source',
        [['Source', 'source', 14], ['Outstanding', 'outstanding'], ['Spendable', 'spendable'], ['Never spendable', 'neverSpendable'],
            ['Expiring 7d', 'expiring7'], ['Expiring 30d', 'expiring30'], ['Expiring 90d', 'expiring90'],
            ['Issued', 'issued'], ['Redeemed', 'redeemed'], ['Expired', 'expired']],
        r.bySource
    );
    addSheet(wb, 'Summary', [['Metric', 'k', 30], ['Value', 'v', 16]], [
        { k: 'As of', v: fmtDate(r.asOf) },
        { k: 'Outstanding coins', v: r.outstanding.total },
        { k: 'Spendable', v: r.outstanding.spendable },
        { k: 'Never spendable', v: r.outstanding.neverSpendable },
        { k: 'Spendable value (INR)', v: r.outstanding.spendableValue },
        { k: 'Expiring in 7 days', v: r.outstanding.expiring.days7 },
        { k: 'Expiring in 30 days', v: r.outstanding.expiring.days30 },
        { k: 'Expiring in 90 days', v: r.outstanding.expiring.days90 },
        { k: 'Issued in range', v: r.period.issued },
        { k: 'Redeemed in range', v: r.period.redeemed },
        { k: 'Returned in range', v: r.period.returned },
        { k: 'Expired in range', v: r.period.expired },
    ]);
    return wb;
}

const handler = (fn, message) => async (req, res, next) => {
    try {
        return sendResponse(res, 200, message, await fn(req.query));
    } catch (error) {
        next(error);
    }
};

const exporter = (fn, build, name) => async (req, res, next) => {
    try {
        const r = await fn(req.query);
        return await sendWorkbook(res, build(r), `${name}_${day(r.range.from)}_${day(r.range.to)}.xlsx`);
    } catch (error) {
        next(error);
    }
};

export const getDeliverySlaReportController = handler(reports.getDeliverySlaReport, 'Delivery SLA report fetched');
export const getCommissionReportController = handler(reports.getCommissionReport, 'Commission report fetched');
export const getCoinLiabilityReportController = handler((q) => reports.getCoinLiabilityReport(q), 'Coin liability report fetched');

export const exportDeliverySlaReportController = exporter(reports.getDeliverySlaReport, slaWorkbook, 'delivery_sla');
export const exportCommissionReportController = exporter(reports.getCommissionReport, commissionWorkbook, 'commission');
export const exportCoinLiabilityReportController = exporter((q) => reports.getCoinLiabilityReport(q), coinWorkbook, 'coin_liability');
