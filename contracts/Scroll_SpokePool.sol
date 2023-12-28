// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import "./SpokePool.sol";
import "@scroll-tech/contracts/L2/gateways/IL2GatewayRouter.sol";
import "@scroll-tech/contracts/libraries/IScrollMessenger.sol";

/**
 * @title Scroll_SpokePool
 * @notice Modified SpokePool contract deployed on Scroll to facilitate token transfers
 * from Scroll to the HubPool
 */
contract Scroll_SpokePool is SpokePool {
    IL2GatewayRouter public l2GatewayRouter;
    IScrollMessenger public l2ScrollMessenger;

    /**************************************
     *               EVENTS               *
     **************************************/

    event ScrollTokensBridged(address indexed token, address indexed receiver, uint256 amount);
    event SetL2GatewayRouter(address indexed newGatewayRouter, address oldGatewayRouter);
    event SetL2ScrollMessenger(address indexed newScrollMessenger, address oldScrollMessenger);

    /**************************************
     *          PUBLIC FUNCTIONS          *
     **************************************/

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(
        address _wrappedNativeTokenAddress,
        uint32 _depositQuoteTimeBuffer,
        uint32 _fillDeadlineBuffer
    ) SpokePool(_wrappedNativeTokenAddress, _depositQuoteTimeBuffer, _fillDeadlineBuffer) {} // solhint-disable-line no-empty-blocks

    /**
     * @notice Construct the Scroll SpokePool.
     * @param _l2GatewayRouter Standard bridge contract.
     * @param _l2ScrollMessenger Scroll Messenger contract on L2.
     * @param _initialDepositId Starting deposit ID. Set to 0 unless this is a re-deployment in order to mitigate
     * @param _crossDomainAdmin Cross domain admin to set. Can be changed by admin.
     * @param _hubPool Hub pool address to set. Can be changed by admin.
     */
    function initialize(
        IL2GatewayRouter _l2GatewayRouter,
        IScrollMessenger _l2ScrollMessenger,
        uint32 _initialDepositId,
        address _crossDomainAdmin,
        address _hubPool
    ) public initializer {
        __SpokePool_init(_initialDepositId, _crossDomainAdmin, _hubPool);
        l2GatewayRouter = _l2GatewayRouter;
        l2ScrollMessenger = _l2ScrollMessenger;
    }

    /**
     * @notice Change the L2 Gateway Router. Changed only by admin.
     * @param _l2GatewayRouter New address of L2 gateway router.
     */
    function setL2GatewayRouter(IL2GatewayRouter _l2GatewayRouter) public onlyAdmin nonReentrant {
        _setL2GatewayRouter(_l2GatewayRouter);
    }

    /**
     * @notice Change L2 message service address. Callable only by admin.
     * @param _l2ScrollMessenger New address of L2 messenger.
     */
    function setL2ScrollMessenger(IScrollMessenger _l2ScrollMessenger) public onlyAdmin nonReentrant {
        _setL2MessageService(_l2ScrollMessenger);
    }

    /**************************************
     *         INTERNAL FUNCTIONS         *
     **************************************/

    /**
     * @notice Bridge tokens to the HubPool.
     * @param amountToReturn Amount of tokens to bridge to the HubPool.
     * @param l2TokenAddress Address of the token to bridge.
     */
    function _bridgeTokensToHubPool(uint256 amountToReturn, address l2TokenAddress) internal virtual override {
        IL2GatewayRouter _l2GatewayRouter = l2GatewayRouter;
        // The scroll bridge handles arbitrary ERC20 tokens and is mindful of
        // the official WETH address on-chain. We don't need to do anything specific
        // to differentiate between WETH and a separate ERC20.
        // Note: This happens due to the L2GatewayRouter.getERC20Gateway() call
        _l2GatewayRouter.withdrawERC20(l2TokenAddress, hubPool, amountToReturn, 0);
        emit ScrollTokensBridged(l2TokenAddress, hubPool, amountToReturn);
    }

    /**
     * @notice Verifies that calling method is from the cross domain admin.
     */
    function _requireAdminSender() internal view override {
        // The xdomainMessageSender is set within the Scroll messenger right
        // before the call to this function (and reset afterwards). This represents
        // the address that sent the message from L1 to L2. If the calling contract
        // isn't the Scroll messenger, then the xdomainMessageSender will be the zero
        // address and *NOT* cross domain admin.
        address _xDomainSender = l2ScrollMessenger.xDomainMessageSender();
        require(_xDomainSender == crossDomainAdmin, "Sender must be admin");
    }

    function _setL2GatewayRouter(IL2GatewayRouter _l2GatewayRouter) internal {
        address oldL2GatewayRouter = address(l2GatewayRouter);
        l2GatewayRouter = _l2GatewayRouter;
        emit SetL2GatewayRouter(address(_l2GatewayRouter), oldL2GatewayRouter);
    }

    function _setL2MessageService(IScrollMessenger _l2ScrollMessenger) internal {
        address oldL2ScrollMessenger = address(l2ScrollMessenger);
        l2ScrollMessenger = _l2ScrollMessenger;
        emit SetL2ScrollMessenger(address(_l2ScrollMessenger), oldL2ScrollMessenger);
    }
}
