import React from 'react';
import {Provider} from 'react-redux';
import {
    createStore,
    applyMiddleware,
    combineReducers
} from 'redux';
import thunkMiddleware from 'redux-thunk';
import createLogger from 'redux-logger'

import {bagger, hasher, uploader} from '../js/reducers';
import Bagger from '../jsx/bagger.jsx';

// http://redux.js.org/docs/basics/UsageWithReact.html

const loggerMiddleware = createLogger()

let createStoreWithMiddleware;

createStoreWithMiddleware = applyMiddleware(thunkMiddleware, loggerMiddleware)(createStore);

const rootReducer = combineReducers({bagger, hasher, uploader});

function configureStore(initialState) {
    return createStoreWithMiddleware(rootReducer, initialState);
}

const store = configureStore();

class App extends React.Component {
    render() {
        return (
            <div>
                <Provider store={store}>
                    <Bagger/>
                </Provider>
            </div>
        )
    }
}

export default App
