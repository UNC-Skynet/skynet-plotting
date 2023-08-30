import { formatFilterName, ZERO_POINT_VALUES } from "./../chart-transient-utils/chart-transient-util";
import { baseUrl, calculateLambda, filterWavelength } from "../chart-cluster-utils/chart-cluster-util";
import { Photometry } from "./photometry";

const DEBUG = false;

export class Model {
    constructor(form: VariableLightCurveForm) {
        this.temporalIndex = parseFloat(form["a_num"].value);
        this.spectralIndex = parseFloat(form["b_num"].value);
        this.referenceTime = parseFloat(form["t_num"].value);
        this.referenceMagn = parseFloat(form["mag_num"].value);
        this.atmExtinction = parseFloat(form["ebv_num"].value);
        this.referenceFltr = form["filter"].value;
    }

    private _temporalIndex: number;
    private _spectralIndex: number;
    private _referenceTime: number;
    private _referenceMagn: number;
    private _atmExtinction: number;
    private _referenceFltr: string;

    get temporalIndex(): number {
        return this._temporalIndex;
    }

    set temporalIndex(i: number) {
        if (isNaN(i) || i === null) {
            this._temporalIndex = -0.65;
        } else {
            this._temporalIndex = i;
        }
    }

    get spectralIndex(): number {
        return this._spectralIndex;
    }

    set spectralIndex(i: number) {
        if (isNaN(i) || i === null) {
            this._spectralIndex = -0.5;
        } else {
            this._spectralIndex = i;
        }
    }

    get referenceTime(): number {
        return this._referenceTime;
    }

    set referenceTime(t: number) {
        if (isNaN(t) || t === null) {
            this._referenceTime = 8.0;
        } else {
            this._referenceTime = t;
        }
    }

    get referenceMagn(): number {
        return this._referenceMagn;
    }

    set referenceMagn(m: number) {
        if (isNaN(m) || m === null) {
            this._referenceMagn = 10.0;
        } else {
            this._referenceMagn = m;
        }
    }

    get atmExtinction(): number {
        return this._atmExtinction;
    }

    set atmExtinction(ae: number) {
        if (isNaN(ae) || ae === null) {
            this._atmExtinction = 0.0;
        } else {
            this._atmExtinction = ae;
        }
    }

    get referenceFltr(): string {
        return this._referenceFltr;
    }

    set referenceFltr(f: string) {
        if (f === null || f === null) {
            this._referenceFltr = 'U';
        } else {
            this._referenceFltr = f;
        }
    }

    /* METHODS */
    calculate(filter: string, currentTime: number, eventTime: number): number {
        const wavelength = filterWavelength;
        const f = wavelength[filter];
        const f0 = wavelength[this.referenceFltr];
        const Rv = 3.1;

        const FZP0 = ZERO_POINT_VALUES[this.referenceFltr];
        const FZP = ZERO_POINT_VALUES[filter];
        const Anu = calculateLambda(this.atmExtinction * Rv, wavelength[this.referenceFltr]);

        // The event time is already factored into the current time. So, only need to subtract
        // the event time from the reference time.
        const eq1 = Math.log10(FZP0 / FZP);
        const eq2 = this.temporalIndex * Math.log10(currentTime / (this.referenceTime - eventTime));
        const eq3 = this.spectralIndex * Math.log10(f / f0);
        const eq4 = Anu / 2.5;

        if (DEBUG) {
            console.log('Flux term: ', eq1);
            console.log('Time term: ', eq2);
            console.log('Frequency term: ', eq3);
            console.log('Extinction term: ', eq4);
            console.log('Combined: ', this.referenceMagn - 2.5 * (eq1 + eq2 + eq3 - eq4));
            console.log('-');
        }
        return this.referenceMagn - (2.5 * (eq1 + eq2 + eq3 - eq4));
    }
}


// algorithmic model
export class NonLinearRegression extends Model {
    xdata: Array<number> = [];
    ydata: Array<number> = [];
    filters: Array<string> = [];

    private _minRange: number = -Infinity;
    private _maxRange: number = Infinity;

    get minRange(): number { return this._minRange; }
    set minRange(m: number) { this._minRange = m; }

    get maxRange(): number { return this._maxRange; }
    set maxRange(m: number) { this._maxRange = m; }

    constructor(form: VariableLightCurveForm) {
        super(form);
    }

    /**
     * Sets the modable data by removing data that is not within the 
     * defined bounds.
     * 
     * @param photometry - Photometry data object
     */
    defineData(photometry: Photometry) {
        for (let row of photometry.data) {
            if (row.julianDate <= this.maxRange && row.julianDate >= this.minRange) {
                this.xdata.push(row.julianDate);
                this.ydata.push(row.magnitude - photometry.getMagnitudeOffset(row.filter));
                this.filters.push(formatFilterName(row.filter));
            }
        }
    }

    async fit() {
        return await this.LSMServerRequest();
    }

    /* METHODS */
    private parameters() {
        if (!this.xdata || !this.ydata) {
            console.log('Missing data');
            return {};
        }
        if (!this.filters) {
            console.log('Missing filters');
            return {};
        }
        if (!this.referenceFltr ||
            isNaN(this.referenceMagn) ||
            isNaN(this.referenceTime) ||
            isNaN(this.temporalIndex) ||
            isNaN(this.spectralIndex)) {
            console.log('Missing form parameter(s)');
            return {};
        }
        return {
            'xdata': this.xdata,
            'ydata': this.ydata,
            'filters': this.filters,
            'params': {
                'm': this.referenceMagn,
                'a': this.temporalIndex,
                'b': this.spectralIndex,
                't': this.referenceTime,
                'filter': this.referenceFltr,
            }
        };
    }

    private LMSFormUpdate(response: any) {
        const form = document.getElementById('transient-form') as VariableLightCurveForm;

        // text entries
        form['a_num'].value = parseFloat(response['popt'][0]);
        form['b_num'].value = parseFloat(response['popt'][1]);

        // sliders
        form['a'].value = parseFloat(response['popt'][0]);
        form['b'].value = parseFloat(response['popt'][1]);
    }

    private LSMServerRequest() {
        return new Promise(resolve => {
            let xmlhttp = new XMLHttpRequest;
            let url = baseUrl + "/transient";
            let updateForm = this.LMSFormUpdate;

            xmlhttp.onload = function () {
                if (this.readyState === XMLHttpRequest.DONE && this.status === 200) {
                    let response = JSON.parse(xmlhttp.responseText);
                    updateForm(response);
                    resolve('success');
                } else {
                    resolve('failure');
                }
            }
            xmlhttp.open("POST", url, true);
            xmlhttp.setRequestHeader("Content-Type", "application/json");
            xmlhttp.send(JSON.stringify(this.parameters()));
        });
    }
}
